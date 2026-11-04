---
title: The passthrough model
description: How connecting a service re-exposes its upstream tools as namespaced, permission-gated hub tools.
---

The hub ships five built-in tools. Everything else an agent can do is reached
through **passthrough**: when a service connects, the hub registers one hub tool
per upstream tool, forwards calls to the upstream client, and returns the
result. This is what makes the wallet's own permission-granting tools and
Swiggy's full tool set directly callable.

## Namespacing

Every passthrough tool is named `<service>__<upstreamName>` — the separator is a
double underscore (`__`). This keeps them from colliding with the built-in hub
tools (`connect_*`, `configure_permissions`, `buy`).

```text
jaw__jaw_send_calls          swiggy__search_products       bitrefill__searchProducts
jaw__jaw_grant_permissions   swiggy__update_cart           bitrefill__createInvoice
jaw__jaw_get_assets          swiggy__checkout              bitrefill__getInvoice
…                            …                             bitrefill__getOrder
```

## Registration lifecycle

1. A `connect_*` tool succeeds.
2. The hub calls `registerServiceTools(server, registry, service)`.
3. For an MCP-backed service (JAW, Swiggy), it calls `listTools()` upstream and
   registers each tool, converting the upstream JSON Schema into a Zod shape so
   the tool advertises its real parameters.
4. For Bitrefill (a REST client, not MCP), it registers four hand-written tools.
5. Registering tools after the server has connected makes `McpServer` emit
   `notifications/tools/list_changed`, so a compliant client refreshes its tool
   list mid-session.

## Permission gate

Every passthrough handler checks `registry.isAllowed(service, upstreamName)`
before forwarding. If the tool is denied, the handler returns a blocked-tool
error and forwards nothing:

```text
ERROR: Blocked by permissions: <service>.<tool> is denied.
Use configure_permissions to allow it.
```

`configure_permissions` writes these flags using the **bare** upstream tool name
(not the namespaced form). See [The permission layer](/overview/permissions/).

## Reconnect is idempotent

Each service's registered tool handles are tracked on the session registry.
Reconnecting removes the previous batch (`handle.remove()` on each) before
registering the new one, so the tool list never accumulates duplicate `jaw__*`
or `swiggy__*` entries.

## Reference pages

- [`jaw__*` — the wallet](/internal/jaw/)
- [`swiggy__*` — Instamart](/internal/swiggy/)
- [`bitrefill__*` — fulfillment and settlement](/internal/bitrefill/)
