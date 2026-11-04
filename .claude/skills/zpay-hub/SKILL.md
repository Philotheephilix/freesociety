---
name: zpay-hub
description: Use when driving the zpay-hub MCP (JAW wallet, Swiggy Instamart, Bitrefill gift cards). Covers which tool pays what, the gift-card top-up flow, and the JAW permission model so you don't pick the wrong tool.
---

# zpay-hub

How to use the zpay-hub MCP correctly. Read before any JAW payment, Swiggy order, or gift-card purchase.

## JAW: which tool moves money — DO NOT CONFUSE THESE

| Action | Tool | Approval |
|---|---|---|
| Pay a **paid web service** (HTTP endpoint charging per call) | `jaw_session_x402_pay` | Drawn from the **x402 budget**, no prompt |
| **Transfer tokens** (e.g. pay a Bitrefill deposit address) | `jaw_send_calls` | Per-tx owner approval link, UNLESS a custom permission allows it |
| Repeated/unattended contract calls under a custom permission | `jaw_session_execute` | None (the permission is the limit) |

**The x402 budget is NOT a transfer allowance.** `jaw_grant_permissions` with `x402Budget` only funds `jaw_session_x402_pay` (web services). It does **not** authorize an ERC-20 `transfer`. Paying a gift-card invoice is a transfer → always `jaw_send_calls` → always prompts, unless you first grant a **custom permission** (`calls` = USDC `transfer` + `spends` = daily cap). Do not tell the user their x402 budget covers a transfer.

### Transfer flow (Base)
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
