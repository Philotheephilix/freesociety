---
name: zpay-hub
description: Use when driving the zpay-hub MCP (JAW wallet, Swiggy Instamart, Bitrefill gift cards). Covers which tool pays what, the gift-card top-up flow, and the JAW permission model so you don't pick the wrong tool.
---

# zpay-hub

How to use the zpay-hub MCP correctly. Read before any JAW payment, Swiggy order, or gift-card purchase.

## Tool names: how they appear to you

The hub re-exposes each connected service's upstream tools **namespaced** as
`<service>__<tool>`. JAW tools are therefore `jaw__jaw_send_calls`,
`jaw__jaw_grant_permissions`, etc. Through a Claude Code MCP client these surface
with the client's own prefix, e.g. `mcp__zpay-hub__jaw__jaw_send_calls`. The bare
names in this doc (`jaw_send_calls`) are the **upstream** names; prepend `jaw__`
(and your client's MCP prefix) to actually call them.

**These tools only exist after `connect_jaw` succeeds in *your* session.** A
"No such tool available" error almost always means JAW is not connected in this
session (or the hub restarted and dropped the session) — reconnect with
`connect_jaw` (passing your `accountId`), do not guess at other names. To see the
exact tools and schemas registered right now, list the hub's tools; the JAW ones
are enumerated live from JAW, so this doc's names can lag — the live list wins.

## JAW: which tool moves money — DO NOT CONFUSE THESE

| Action | Tool | Approval |
|---|---|---|
| Pay a **paid web service** (HTTP endpoint charging per call) | `jaw_session_x402_pay` | Drawn from the **x402 budget**, no prompt |
| **Transfer tokens** (e.g. pay a Bitrefill deposit address) | `jaw_send_calls` | Per-tx owner approval link, UNLESS a custom permission allows it |
| Repeated/unattended calls under a custom permission | `jaw_session_execute` | None (the permission is the limit; pass its `permissionId`) |

**The x402 budget is NOT a transfer allowance.** `jaw_grant_permissions` with
`x402Budget` only funds `jaw_session_x402_pay` (web services). It does **not**
authorize an ERC-20 `transfer`. Paying a gift-card invoice is a transfer →
`jaw_send_calls` (prompts per-tx), unless you first grant a **custom permission**.
Do not tell the user their x402 budget covers a transfer.

### Granting a custom permission (e.g. "3 USDC/day for transfers")

Use `jaw_grant_permissions`. Verified argument shape:

- `spends`: array of `{ token, allowance, unit, multiplier? }`.
  - `allowance` is in **base units as a decimal-integer string** — USDC has 6
    decimals, so 3 USDC = `"3000000"`, 1 USDC = `"1000000"`. Do NOT pass `"3"`.
  - `unit` is one of minute/hour/day/week/month/year/forever. A per-day cap is
    `"day"`.
- `calls`: array of `{ target, functionSignature, checker? }`. **Omit it for a
  plain token transfer** — `spends` alone authorizes `transfer(address,uint256)`
  of those tokens to any address, within the limit. Only pass `calls` to allow
  calling specific other contract functions.
- `chainId`: `8453` for Base.

So "3 USDC per day, transfers" on Base is:
```json
{
  "spends": [{ "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "allowance": "3000000", "unit": "day" }],
  "chainId": 8453
}
```
`jaw_grant_permissions` returns a **link + an `id`** — show the link on its own
line, one sentence of what it allows (contract, cap, period, that it's revocable).
Then poll `jaw_get_grant_status` with that `id` and `waitSeconds: 30`, repeating
while it says `awaiting_owner`. Once approved it yields a `permissionId`; later
unattended spends run through `jaw_session_execute` with that `permissionId`
(up to the cap, no further prompts). Ask for the narrowest permission that works.

### Transfer flow (Base) — one-off, no standing permission
1. `jaw_get_assets` (chainId 8453) — confirm USDC balance covers it.
2. `jaw_prepare_calls` — build `transfer(address,uint256)` to the USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (amount in 6-decimal base units).
3. `jaw_simulate_calls` — if it fails `AA21 didn't pay prefund`, the wallet has no ETH for gas. Re-simulate with `paymaster: {mode:"erc20", token:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"}` (pay gas in USDC). Needs ≥0.5 USDC held.
4. `jaw_send_calls` — show the approval link on its own line, one sentence of what it moves.
5. `jaw_get_calls_status` (waitSeconds 30), repeat while `awaiting_owner`/`sent` until `landed`.

### JAW token expires mid-session
A poll can 401 `invalid_token`. The tx is already broadcast — don't panic. Call `connect_jaw` again, then re-poll `jaw_get_calls_status` with the same id.

## Swiggy gift cards — NOT a Swiggy product

**Never search Swiggy / Instamart for a gift card, and never use the `buy` tool for one.** The `buy` tool's `claim_gift_card` only fires as a *checkout-recovery* path (insufficient Swiggy Money balance) — it refuses standalone gift-card requests. There is no direct "buy gift card" MCP tool.

Gift cards go through Bitrefill via the CLI:
1. `connect_bitrefill` with the API key (required; `buy` returns `PAYMENT_REQUIRED_NO_BITREFILL` otherwise).
2. `npx tsx src/giftcard.ts --prepare <INR>` → prints invoice id, Base deposit address, USDC amount. Valid denominations: 50, 100, 250, 500, 1000, 2000, 5000, 10000.
3. Pay the deposit address with **`jaw_send_calls`** (a transfer — see above), not x402.
4. `npx tsx src/giftcard.ts --settle <invoiceId>` → polls Bitrefill, redeems voucher into Swiggy Money on the emulator. Run in background (up to 10 min).
   - If the voucher isn't delivered yet (Swiggy cards can take days), re-check later: `npx tsx src/giftcard.ts --order <orderId>`.
5. Redemption submits on the emulator but can't fully confirm the credit — point the user at the screenshot (`/tmp/zpay-redeem-result.png`).

## Swiggy Instamart orders

- Payment is **always `SwiggyPay` (Swiggy Money)**. Never Cash/COD/UPI/card — the hub's `buy` enforces this and blocks forbidden methods.
- Use the `buy` tool for groceries/essentials. Pass the full `addressId` string verbatim.
- To add an address: `create_address` requires name, 10-digit phone (digits only, no +91), postal code, and type (HOME/WORK/OFFICE/FRIENDS_AND_FAMILY/OTHER). Parse the rest from the free-text address yourself; don't ask the user to break it into fields.
- For free-delivery thresholds (e.g. ≥₹99), tell the `buy` tool the target so it adds enough quantity.

## Preflight checklist
- [ ] Right tool for the money movement? (x402 = web service; `jaw_send_calls` = transfer)
- [ ] Bitrefill connected before any gift-card prepare?
- [ ] Simulated the transfer with the USDC paymaster if the wallet has no ETH?
- [ ] Not searching Swiggy for a gift card?
