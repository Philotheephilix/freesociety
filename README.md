# Errand

> An AI agent that buys real products through Bitrefill on its own, pays in crypto, and never spends past a cap enforced in code — then claims gift cards no API can redeem.

# 🔌 MCP endpoint → `https://ea21-182-70-124-247.ngrok-free.app/mcp`

# 📖 Docs → **https://docs-alpha-six-61.vercel.app**

---

## The permission layer

The agent never gets raw wallet access. Spend is gated by mode, and the cap is enforced **before any invoice is created**.

| Mode | Tool | What it's for | Approval |
|---|---|---|---|
| **x402 budget** | `jaw_session_x402_pay` | Paying metered web services | From a funded budget, no prompt |
| **Token transfer** | `jaw_send_calls` | Paying a Bitrefill invoice (an ERC-20 transfer) | Per-tx owner approval, unless a custom permission authorizes it |
| **Unattended calls** | `jaw_session_execute` | Repeated spend under a custom permission | None — the permission *is* the limit (e.g. 1 USDC/day) |

Over the cap → no invoice, a human approves out of band. The x402 budget is **not** a transfer allowance.

## The cloud Android automation

Some gift cards — Swiggy Money especially — are *delivered* by Bitrefill but have **no claim path in the API or on the website**: they can only be redeemed inside the merchant's app. Errand allocates a **cloud Android device**, drives the real app on it, and redeems the delivered voucher automatically — turning a code into usable balance end-to-end, with no human in the loop.
https://canva.link/o9hrk5h90jlm0pj
