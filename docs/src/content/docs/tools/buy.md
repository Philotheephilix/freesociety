---
title: buy
description: Order Instamart items end to end, paid in Swiggy Money, under an optional spend cap.
---

Runs a Swiggy Instamart purchase end to end: an internal agent fetches
addresses, searches products, builds the cart, confirms the bill, and checks out
paid in Swiggy Money. If Swiggy Money is short at checkout, it can begin a
Bitrefill gift-card top-up — but it never retries the checkout on its own.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `items` | string | Yes | A free-text description of what to order (items, quantities, and any target such as a free-delivery threshold). The internal agent parses this. |
| `maxSpendUsdc` | number | No | Upper bound on spend, in USDC. The cart is priced and checked against this before any invoice is created. |

`items` is natural language, not a structured array — for example
`"2L milk, a dozen eggs, and enough snacks to clear the ₹99 free-delivery
threshold"`. The agent picks the smallest suitable pack sizes and replaces the
whole cart in one update.

## Payment policy

Payment is always **SwiggyPay** (Swiggy Money). Cash, COD, UPI, card, net
banking, and pay-later are rejected in two layers (see
[Safety guardrails](/overview/safety/)). The tool cannot be made to use another
method.

## Prerequisites

- **Swiggy connected** — otherwise returns `Swiggy not connected`.
- For the gift-card top-up recovery path: **JAW** and **Bitrefill** connected,
  and the JAW pay tool not denied by `configure_permissions`.

## Return values

`buy` returns a text result. The leading token tells you the outcome:

| Return | Meaning |
| --- | --- |
| `{ "ok": true, "summary": … }` | Order placed (or the agent's final summary). |
| `SUCCESS: …` | A top-up gift card was purchased **and** redeemed into Swiggy Money. |
| `TOPUP_PENDING: …` | The top-up gift card was purchased and paid, but the voucher is not yet redeemed (Swiggy cards can take time to deliver). |
| `PAYMENT_REQUIRED_NO_JAW` | A top-up is needed but JAW is not connected. Call `connect_jaw`. |
| `PAYMENT_REQUIRED_NO_BITREFILL` | A top-up is needed but Bitrefill is not connected. Call `connect_bitrefill`. |
| `JAW_NO_PAY_TOOL` | No JAW tool matching `/pay\|send\|transfer/` was found. |
| `PAYMENT_BLOCKED` | The JAW pay tool is denied by `configure_permissions`. |
| `{ "ok": false, "error": … }` | Setup error (e.g. Swiggy not connected) or an exception. |

:::caution
When the top-up path returns `PAYMENT_REQUIRED_*` or `TOPUP_PENDING`, **stop**.
Do not retry the checkout. The order can only complete after the owner's wallet
has paid and the voucher has been redeemed into Swiggy Money, which happens out
of band.
:::

## Gift cards are not a `buy` product

The gift-card path inside `buy` is a **checkout-recovery** step only — it fires
when Swiggy Money is insufficient, with a top-up value at least as large as the
shortfall (denominations: 50, 100, 250, 500, 1000, 2000, 5000, 10000 INR). It
refuses standalone gift-card requests. To buy a gift card deliberately, use the
[Gift-card CLI flow](/giftcard/overview/).

## Loop guard

The internal agent runs at most 30 turns. If it hits the limit it returns its
last summary with a loop-guard note rather than looping indefinitely.
