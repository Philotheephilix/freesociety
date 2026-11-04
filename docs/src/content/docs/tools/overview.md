---
title: Hub tools overview
description: The five built-in tools every session starts with, and what each one does.
---

Every Errand session begins with exactly five built-in tools. They connect
services, gate capabilities, and run the one end-to-end purchase flow the hub
owns directly. Everything else is reached through the
[passthrough model](/internal/passthrough/) after you connect a service.

| Tool | Purpose | Reference |
| --- | --- | --- |
| `connect_jaw` | Connect the permissioned wallet; returns a login URL. | [Reference](/tools/connect-jaw/) |
| `connect_bitrefill` | Connect Bitrefill with an API key (stored for reconnects). | [Reference](/tools/connect-bitrefill/) |
| `connect_swiggy` | Connect Swiggy for Instamart ordering. | [Reference](/tools/connect-swiggy/) |
| `configure_permissions` | Allow or deny individual upstream tools per service. | [Reference](/tools/configure-permissions/) |
| `buy` | Order Instamart items end to end, paid in Swiggy Money, under a cap. | [Reference](/tools/buy/) |

## The usual order

1. **Connect Bitrefill first.** Fulfillment and settlement run through Bitrefill;
   `buy` returns `PAYMENT_REQUIRED_NO_BITREFILL` if it is not connected.
2. **Connect JAW** to bring the wallet online, then grant an on-chain spend cap.
3. **Connect Swiggy** only if you are ordering groceries through `buy`.
4. **Configure permissions** to deny any upstream tool the task does not need.
5. **`buy`** (or the [gift-card CLI](/giftcard/overview/) for vouchers).

## What a connect does beyond connecting

Each `connect_*` does two things: it brings the service online in the session
registry, and it registers that service's upstream tools as namespaced
passthrough tools. That second step is what makes the wallet's own
permission-granting tools, and Swiggy's full tool set, callable directly.
Reconnecting a service is idempotent — the old passthrough handles are removed
before the new ones are registered.
