---
title: swiggy__* — Instamart
description: The Swiggy Instamart tools exposed as passthrough, the ordering sequence, and the gift-card prohibition.
---

After [`connect_swiggy`](/tools/connect-swiggy/), every Swiggy tool is available
as a `swiggy__*` passthrough tool. The set is discovered at runtime from the
Swiggy MCP endpoint, so it tracks what Swiggy exposes. In practice most orders go
through the [`buy`](/tools/buy/) tool, which drives these under the hood — but
you can call them directly when you need finer control.

## The ordering sequence

`buy` follows this exact sequence; direct callers should too:

1. **`swiggy__get_addresses`** — fetch saved delivery addresses. Pick the
   default/suggested one and copy the **full** `addressId` string verbatim,
   including everything after the `__` separator.
2. **`swiggy__search_products`** — once per item; pick the smallest suitable
   pack size.
3. **`swiggy__update_cart`** — send **all** items together; it replaces the
   whole cart. Pass the full `selectedAddressId` from step 1.
4. **`swiggy__get_cart`** — confirm items and read the bill total.
5. **`swiggy__get_payment_options`** — confirm Swiggy Money (`SwiggyPay`) is
   present.
6. **`swiggy__checkout`** — place the order. You must pass **both** the full
   `addressId` (verbatim) and `paymentMethod` = exactly `SwiggyPay`.

## Adding an address

`swiggy__create_address` requires:

- `name`
- a 10-digit phone number — digits only, no country code
- a postal code
- a type — one of `HOME`, `WORK`, `OFFICE`, `FRIENDS_AND_FAMILY`, `OTHER`

Parse the rest of a free-text address yourself; do not ask the user to break it
into fields.

## Payment is SwiggyPay only

Checkout accepts exactly `SwiggyPay` (Swiggy Money). Cash, COD, UPI, card, net
banking, and pay-later are rejected in two code layers whenever the hub drives a
checkout. Never substitute another method — see
[Safety guardrails](/overview/safety/).

## Gift cards are not a Swiggy product

:::danger
Never search Swiggy or Instamart for a gift card, and never use these tools to
buy one. There is no "buy a gift card" Swiggy tool. Gift cards are delivered by
Bitrefill — follow the [Gift-card CLI flow](/giftcard/overview/).
:::

## Free-delivery thresholds

When an order has a free-delivery threshold (for example ≥ ₹99), state the
target to [`buy`](/tools/buy/) so it adds enough quantity to clear it, rather
than managing the cart by hand.
