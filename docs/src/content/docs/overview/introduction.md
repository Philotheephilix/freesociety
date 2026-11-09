---
title: Introduction
description: What Errand is, who it is for, and the problem it solves.
---

Errand — the **zpay-hub** — is a Streamable-HTTP MCP server that any MCP client
(Claude Code, Cursor, and other MCP-capable agents) connects to. It lets an
autonomous AI agent buy real products through Bitrefill, pay in USDC on Base,
and never spend past a cap enforced in code. It also claims gift cards that have
no Bitrefill API or website redemption path, by redeeming them automatically on
a cloud Android device.

```text
Public endpoint   https://73e0-165-1-155-35.ngrok-free.app/mcp
Transport         Streamable HTTP · JSON-RPC
Server identity   zpay-hub v1.0.0
```

## Who it is for

Errand is built for developers putting a wallet behind an agent. The reader of
these docs wants the exact tool name, its parameters, its return shape, and the
permission semantics that gate it — then a copy-paste configuration for their
client. Every reference page here is written to answer that in one read.

## The problem it solves

Fulfillment — search, buy, pay — is what Bitrefill already does. Errand adds the
three things it does not:

- **A guarantee.** A hard, pre-purchase spend cap and a permission layer the
  agent cannot exceed. The cart is priced and checked *before* any invoice is
  created.
- **An ending.** Some products — Swiggy Money gift cards in India especially —
  are *delivered* by Bitrefill but have no claim or redeem path in the MCP or on
  the Bitrefill website. Errand redeems them automatically on a cloud device,
  turning a delivered code into usable balance end to end.
- **A user.** The customer is an autonomous agent with a wallet, not a person
  clicking checkout.

## How the hub is shaped

The hub exposes five built-in tools. Once you connect a service, it re-exposes
that service's upstream tools namespaced per service — `jaw__*`, `swiggy__*`,
`bitrefill__*` — so the agent can drive them directly, every call behind the
permission gate.

| Built-in tool | Purpose |
| --- | --- |
| `connect_jaw` | Connect the permissioned wallet. Opens JAW login; returns the login URL. |
| `connect_bitrefill` | Connect Bitrefill. Pass `apiKey` once; it is stored for later reconnects. |
| `connect_swiggy` | Connect Swiggy for Instamart ordering. |
| `configure_permissions` | Allow or deny individual upstream tools per service. |
| `buy` | Order Instamart items end to end, paid in Swiggy Money, with an optional `maxSpendUsdc`. |

Continue to [Architecture](/overview/architecture/) for how these fit together,
or jump to the [Quickstart](/install/quickstart/).
