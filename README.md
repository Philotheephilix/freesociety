# zpay — autonomous agent commerce with a spend cap

> An AI agent that buys real products through Bitrefill on its own, pays in crypto, and never spends past a cap you set in code. It also claims gift cards that no Bitrefill API — or website — can redeem.

**Lane:** 1 (Rails & guardrails) + 2 (Close the loop) · **The loop:** agent intent → permission + spend cap → Bitrefill (search → buy → pay in USDC) → auto-claim on a cloud device → spendable balance

- **Demo:** <video link>
- **Real purchase invoice ID:** <id>
- **Repo:** https://github.com/Philotheephilix/freesociety
- **Track:** Agentic Commerce (Bitrefill)

---

## What it does

- **Personal AI agents can freely purchase.** Zero-click autonomous agent commerce — tell it what you need once; the agent decides, pays, and completes. No human at checkout.
- **Pay with any crypto, anywhere.** Purchases settle on-chain (USDC on Base today) through Bitrefill's crypto invoices, so an agent with a wallet can buy global products without a card or a Bitrefill balance.
- **A permission layer so the AI never holds an unrestricted wallet.** The agent is allowed to spend only a bounded amount of USDC, only through approved modes (x402 for web services, or a contract transfer under a daily cap). The cap is enforced **before any purchase** — above it, nothing is bought and a human approves.
- **We fill the gap Bitrefill can't close.** Some India gift cards — Swiggy Money especially — are *delivered* by Bitrefill but have **no claim/redeem path in the MCP or on the Bitrefill website**. zpay allocates a virtual device (a cloud Android environment, like an emulated phone for anyone) and redeems the voucher there automatically, turning a delivered code into usable balance end-to-end.
- **Untraceable-to-spendable, globally.** The result is an easy way to spend crypto on real-world goods anywhere, with the claim step — the part everyone else leaves to the human — automated.

## Why it's new

Fulfillment (search, buy, pay) is what Bitrefill already does. zpay adds the three things it doesn't:

1. a **guarantee** — a hard, pre-purchase spend cap and a permission layer the agent can't exceed;
2. an **ending** — automated redemption of cards that have no API claim path;
3. a **user** — an autonomous agent with a wallet, not a person clicking checkout.

---

## The permission layer (how the cap is enforced)

The agent never gets raw wallet access. Spend is gated by mode:

| Mode | Tool | What it's for | Approval |
|---|---|---|---|
| **x402 budget** | `jaw_session_x402_pay` | Paying metered web services | Drawn from a funded budget, no prompt |
| **Token transfer** | `jaw_send_calls` | Paying a Bitrefill crypto invoice (an ERC-20 transfer) | Per-transaction owner approval, **unless** a custom permission authorizes it |
| **Unattended contract calls** | `jaw_session_execute` | Repeated spend under a custom permission | None — the permission *is* the limit (e.g. 1 USDC/day) |

Before an invoice is ever created, the cart is priced from Bitrefill's `payment_price` and checked against the per-purchase and per-day cap. Over the cap → no invoice, human approves out of band. The x402 budget is **not** a transfer allowance; a gift-card payment is always a transfer under the daily cap.

---

## Bitrefill touchpoints (built vs reused)

- **Reused:** Bitrefill REST API v2 for fulfillment — `POST /invoices` with `payment_method: "usdc_base"`, then invoice/order status polling to **delivered**. Crypto payment addresses and exact amounts come straight from the invoice.
- **Built:** the permission + spend-cap layer in front of every purchase; the USDC-on-Base payment path through a permissioned wallet; and the cloud-device auto-claim that redeems delivered vouchers Bitrefill has no claim path for.

---

## Architecture

zpay runs as a **Streamable-HTTP MCP server** (the "hub") that any MCP client (Claude Code, Cursor, …) connects to. The hub exposes a few built-in tools and, after you connect a service, re-exposes that service's upstream tools namespaced (`jaw__*`, `swiggy__*`, `bitrefill__*`) so the agent can drive them directly — all behind the permission gate.

Built-in hub tools:

| Tool | Purpose |
|---|---|
| `connect_jaw` | Connect the permissioned wallet (opens JAW login in the browser, returns the login URL). |
| `connect_bitrefill` | Connect Bitrefill. Pass `apiKey` once; it's stored for later reconnects. |
| `connect_swiggy` | Connect Swiggy (for Instamart ordering). |
| `configure_permissions` | Allow/deny individual upstream tools per service. |
| `buy` | Order Instamart items end-to-end, paid in Swiggy Money, with an optional `maxSpendUsdc`. |

Gift-card claim runs through a small CLI (`src/giftcard.ts`): prepare an invoice → wallet pays the deposit address → settle and redeem on the device.

---

## Run it (under 15 minutes)

**Prereqs:** Node 20+, a Bitrefill API key on a zero-balance dev account, a JAW wallet, and (for gift-card claiming) Android SDK with an emulator/AVD.

### 1. Install

```bash
git clone https://github.com/Philotheephilix/freesociety.git
cd freesociety
npm install
```

### 2. Configure the environment

Create a `.env` (never commit it — codes and keys are cash):

```bash
BITREFILL_API_KEY=...        # zero-balance dev account; stored on first connect
ANTHROPIC_API_KEY=...        # for the buy agent
ZPAY_HUB_PORT=3400           # optional, default 3400
# Gift-card claim (optional):
ANDROID_HOME=...             # Android SDK
AVD_NAME=...                 # emulator image to boot
```

### 3. Start the hub (MCP server)

```bash
npm run hub
# → zpay-hub listening on http://localhost:3400/mcp
```

### 4. Connect your MCP client

The repo ships an `.mcp.json` that registers the hub for Claude Code:

```json
{
  "mcpServers": {
    "zpay-hub": { "type": "http", "url": "http://localhost:3400/mcp" }
  }
}
```

In Claude Code (or any MCP client), point at `http://localhost:3400/mcp` over Streamable HTTP. Then, in the agent:

1. `connect_jaw` → open the returned login URL, authorize the wallet.
2. `connect_bitrefill` with your `apiKey` (stored for next time).
3. (Optional) set a daily cap via the JAW wallet-permission passthrough tool, then `configure_permissions` to lock down which tools the agent may call.
4. Ask the agent to buy — it prices the cart, checks the cap, creates the invoice, pays in USDC, and polls to delivered.

### 5. Buy a gift card and auto-claim it

```bash
# Prepare a crypto invoice (valid INR denominations: 50,100,250,500,1000,2000,5000,10000)
npx tsx src/giftcard.ts --prepare 500
#   → prints invoice id, Base deposit address, exact USDC amount

# The JAW wallet pays that deposit address (jaw_send_calls — a transfer under the cap)

# Settle: poll Bitrefill to delivered, then redeem the voucher on the emulator
npx tsx src/giftcard.ts --settle <invoiceId>

# If the voucher is slow (cards can take time), re-check and redeem later:
npx tsx src/giftcard.ts --order <orderId>
```

Record the delivered invoice ID above once your first real purchase completes.

### Quick checks

```bash
npm run build        # typecheck
npm run test:e2e     # end-to-end hub test
```

---

## Guardrails

- **Max per purchase / per day:** enforced in code before any invoice is created (the cart is priced from Bitrefill `payment_price` and rejected if it exceeds the cap).
- **Modes, not raw wallet access:** the agent may spend only via x402 (web services) or a capped contract transfer — it never holds an unrestricted wallet address.
- **Above the cap:** nothing is bought; a human approves out of band.
- **Codes are cash:** vouchers are never logged, printed, committed, or posted; redemption happens on the device and the user is pointed at a screenshot, not a pasted code.

## Safety notes

- Money-moving calls are **never auto-retried** — if a payment request's response is lost, a blind retry could double-spend. Only idempotent reads retry.
- Credential refresh is silent (refresh token only); an unattended run fails fast instead of hanging on a browser login.

## Feedback

See [FEEDBACK.md](./FEEDBACK.md).
