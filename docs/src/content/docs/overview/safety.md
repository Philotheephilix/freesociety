---
title: Safety guardrails
description: The code-enforced invariants that make it safe to put a wallet behind an autonomous agent.
---

These are not guidelines. They are invariants enforced in code, and they are the
reason it is safe to hand a wallet to an autonomous agent.

## No retry on money-moving RPC

Network retry is **off by default** for any non-idempotent call — anything that
moves money. A transfer that times out is never silently re-sent, because a
re-sent transfer is a double-spend. When a poll returns `401 invalid_token`
mid-flight, the transaction is already broadcast; the correct recovery is to
re-authenticate and re-poll the *same* transaction id, never to resubmit.

Authentication refresh is the one silent retry allowed, and only because
refreshing a token moves no money.

## The spend cap is checked before any invoice exists

The `buy` tool prices the full cart and checks it against `maxSpendUsdc`
*before* it creates a Bitrefill invoice. The cap is a pre-purchase gate, not a
post-hoc reconciliation. If the cart exceeds the cap, no invoice is created and
nothing is paid.

## Codes are cash

A delivered gift-card code or voucher is bearer value. It is never logged,
printed to a shared channel, committed to the repository, or posted anywhere.
Redemption happens on the device; the user is pointed at a screenshot, not at
the raw code in transcript output.

## SwiggyPay only

The `buy` tool accepts exactly one payment method: **SwiggyPay** (Swiggy Money).
Cash, COD, UPI, and card are in an explicit forbidden set and are rejected in
two independent layers:

```text
enforcePaymentPolicy (layer 1)  — rejects any method not equal to "SwiggyPay"
FORBIDDEN_METHODS set (layer 2) — rejects cash / cod / upi / card / … explicitly
```

Both layers must pass. A caller cannot talk the tool into another rail.

## Gift cards are not a `buy` product

The `buy` tool's gift-card claim path (`claim_gift_card`) fires **only** as a
checkout-recovery step when Swiggy Money balance is insufficient. It refuses
standalone gift-card requests. There is no direct "buy a gift card" MCP tool —
gift cards go through the [Bitrefill CLI flow](/giftcard/overview/). Never search
Instamart for a gift card.

## Permission boundaries are respected

The hub respects the network ACL it runs behind. A tool call that would cross a
boundary the operator has closed is not laundered through the hub. If an action
is denied at the boundary, it stays denied — the agent does not get a second
path to it.

## Why these matter together

Individually each rule prevents one failure. Together they make the failure
modes of an autonomous wallet *bounded*: the worst case is capped in dollars (the
spend cap and on-chain permission), cannot be duplicated (no money-RPC retry),
cannot leak value (codes are cash), and cannot switch to an unaudited rail
(SwiggyPay only). Continue to the [Quickstart](/install/quickstart/).
