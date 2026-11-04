---
title: Business model
description: The markup is 1% of Bitrefill's commission. Nothing else. Here is how that works.
---

Errand's price is simple enough to state in one line: **the markup is 1% of
whatever commission Bitrefill makes** on transactions settled through the hub.
This page explains what that means and why it is the entire model.

## Where the money comes from

Errand settles purchases through Bitrefill. Bitrefill earns a commission on
those transactions as it normally does. Errand takes **1% of that commission** —
a markup on Bitrefill's margin, not a markup on your spend.

```text
Your spend ─────────────────────────────────────▶ Bitrefill
                                                      │ earns its usual commission C
                                                      ▼
                                          Errand markup = 1% × C
```

If Bitrefill earns no commission on a transaction, Errand's markup on it is zero.
The fee is strictly a fraction of a fraction.

## What is not charged

- **No integration build fee.** Requesting and shipping a custom integration
  through the [marketplace](/marketplace/overview/) costs nothing up front.
- **No per-seat or per-agent fee.** Connect as many agents as you like.
- **No subscription.** There is no monthly floor to clear.

The only money that changes hands beyond the purchase itself is the 1% of
Bitrefill's commission.

## Why this alignment is the point

Errand earns only when a transaction actually settles and Bitrefill actually
earns on it. That ties Errand's revenue directly to delivered value:

- We are paid for **completed** automation, not for access.
- An integration that no one uses costs you nothing and earns us nothing.
- There is no incentive to inflate your spend — our cut comes from Bitrefill's
  margin, not your bill.

## The safety layer is included

Every transaction still runs behind the hub's guarantees — a pre-purchase spend
cap, permission gating, and no retry on money-moving calls (see
[Safety guardrails](/overview/safety/)). These are part of the product, not an
add-on. The 1% buys the integration, the hosting, and the safety model together.

## Next

- [Request an integration](/marketplace/request/) to put the model to work.
- [Join the waitlist](/marketplace/waitlist/) to register interest early.
