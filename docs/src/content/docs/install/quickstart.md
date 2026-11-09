---
title: Quickstart
description: Point your MCP client at the hub, connect the services, and run the first purchase.
---

Errand is a hosted MCP server. There is nothing to install locally — you point
your MCP client at the public endpoint and connect the services you need.

```text
Endpoint    https://73e0-165-1-155-35.ngrok-free.app/mcp
Transport   Streamable HTTP
```

## 1. Add the server to your client

Pick your client for the exact configuration:

- [Claude Code](/install/claude-code/)
- [Cursor](/install/cursor/)
- [Any other MCP client](/install/generic/)

All three point at the same `https://73e0-165-1-155-35.ngrok-free.app/mcp` endpoint
over Streamable HTTP.

## 2. Connect the services

Once the server is registered, your agent sees five tools. Connect what the task
needs:

1. **`connect_bitrefill`** — pass your Bitrefill `apiKey` once. Required before
   any purchase or gift-card flow; the key is stored for later reconnects.
2. **`connect_jaw`** — opens JAW login and returns a login URL. Complete login
   in the browser; the permissioned wallet is then connected.
3. **`connect_swiggy`** — connect Swiggy for Instamart ordering (only if you are
   ordering groceries).

After each successful connect, the service's upstream tools appear namespaced
(`bitrefill__*`, `jaw__*`, `swiggy__*`) and your client refreshes its tool list.

## 3. Set a spend cap

Before letting the agent move money unattended, grant an on-chain limit through
JAW so transfers cannot exceed it:

- Grant a **custom permission** (a USDC `transfer` call with a daily `spends`
  cap) via `jaw__jaw_grant_permissions`.

See [The permission layer](/overview/permissions/) for why the x402 budget is
*not* a substitute for this.

## 4. Run the first purchase

For an Instamart order, call `buy` with a free-text `items` description and a
`maxSpendUsdc` ceiling:

```json
{
  "items": "2L milk and a dozen eggs",
  "maxSpendUsdc": 5
}
```

The internal agent resolves your saved address, prices the cart, checks it
against the cap before any invoice is created, and settles in Swiggy Money. See
the [`buy` reference](/tools/buy/) for every return code.

For a gift card — which is **not** a `buy` product — follow the
[Gift-card CLI flow](/giftcard/overview/) instead.
