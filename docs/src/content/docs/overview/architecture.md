---
title: Architecture
description: How the hub, the passthrough model, and the permission layer fit together.
---

Errand is one process: a [Model Context Protocol](https://modelcontextprotocol.io)
server named **zpay-hub**, reachable over Streamable HTTP at `/mcp`. A reverse
proxy fronts it — this documentation site is served from the same domain root,
with `/mcp` proxied to the hub.

```text
MCP client ──HTTP──▶ 73e0-165-1-155-35.ngrok-free.app/mcp ──▶ zpay-hub (:3400)
                                                         │
                                 ┌───────────────────────┼───────────────────────┐
                                 ▼                       ▼                        ▼
                              JAW (MCP)              Swiggy (MCP)           Bitrefill (REST)
                           permissioned wallet      Instamart ordering     product catalog + invoices
```

## Per-session registry

Each MCP session gets its own `Registry`. The registry holds the connected
service clients (`jaw`, `swiggy`, the Bitrefill client), the per-service
permission map, and the handles for every passthrough tool registered for that
session. Nothing leaks between sessions: one client's connected wallet and
allow/deny settings are invisible to another.

## Five built-in tools, then passthrough

At `initialize`, a fresh session advertises only the five built-in tools:
`connect_jaw`, `connect_bitrefill`, `connect_swiggy`, `configure_permissions`,
`buy`. Nothing upstream is reachable yet.

When you call a `connect_*` tool and it succeeds, the hub enumerates that
service's upstream tools and registers one hub tool per upstream tool,
namespaced with a `__` separator:

- `connect_jaw` → `jaw__<tool>` for every JAW wallet tool
- `connect_swiggy` → `swiggy__<tool>` for every Swiggy tool
- `connect_bitrefill` → the four `bitrefill__*` tools (REST, hand-wrapped)

Registering tools after `initialize` fires `notifications/tools/list_changed`,
so a compliant client refreshes its tool list mid-session and the new tools
become callable immediately.

## Reconnect is idempotent

Reconnecting a service removes that service's previously-registered passthrough
handles before registering the new batch, so you never end up with duplicate
`jaw__*` tools. See [The passthrough model](/internal/passthrough/) for the
registration and teardown detail.

## Where money moves

Two services move money, and they move it differently:

- **JAW** is the permissioned wallet. A token transfer (paying a Bitrefill
  deposit address) goes through `jaw_send_calls` and draws against an on-chain
  permission. A paid web-service call goes through `jaw_session_x402_pay` and
  draws against the x402 budget. These are **not interchangeable** — see
  [Safety guardrails](/overview/safety/).
- **`buy`** settles Instamart orders in Swiggy Money only. No cash, COD, UPI, or
  card is ever accepted; the policy is enforced in two layers in code.

Continue to [The permission layer](/overview/permissions/).
