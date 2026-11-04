---
title: connect_swiggy
description: Connect Swiggy for Instamart ordering and register the swiggy__* passthrough tools.
---

Connects Swiggy and registers every Swiggy tool as a `swiggy__*` passthrough
tool. Needed only when ordering groceries and essentials through
[`buy`](/tools/buy/).

## Parameters

None. `connect_swiggy` takes no arguments; it authenticates through the stored
Swiggy credentials.

## Behaviour

1. Obtains a Swiggy access token.
2. Connects to the Swiggy MCP endpoint, using **silent** token refresh only — an
   unattended call is never blocked on a browser OAuth round-trip.
3. On success, stores the Swiggy client on the session registry and registers
   each Swiggy tool as `swiggy__<tool>`.

## Returns

A JSON string.

On success:

```json
{ "ok": true, "toolCount": 12 }
```

- `toolCount` — number of Swiggy tools now available as `swiggy__*` passthrough
  tools.

On failure:

```json
{ "ok": false, "error": "<message>" }
```

## Addresses

Instamart orders need an address id. To add one, use the Swiggy address tool
(`swiggy__create_address`), which requires a name, a 10-digit phone number
(digits only, no country code), a postal code, and a type
(`HOME` / `WORK` / `OFFICE` / `FRIENDS_AND_FAMILY` / `OTHER`). Pass the full
address id string verbatim to [`buy`](/tools/buy/).

## Next

Browse the Swiggy tools at [`swiggy__*`](/internal/swiggy/), then place an order
with [`buy`](/tools/buy/). Remember: never search Swiggy for a gift card — that
is a [Bitrefill flow](/giftcard/overview/).
