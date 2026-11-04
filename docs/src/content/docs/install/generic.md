---
title: Generic MCP client
description: Register Errand in any MCP client that supports Streamable HTTP.
---

Any client that implements the Model Context Protocol over Streamable HTTP can
use Errand. The only two facts you need are the endpoint and the transport.

```text
Endpoint    https://errand.philotheephilix.in/mcp
Transport   Streamable HTTP (JSON-RPC)
```

## Configuration

Most clients take a server entry with a URL. The common shape:

```json
{
  "mcpServers": {
    "errand": {
      "url": "https://errand.philotheephilix.in/mcp"
    }
  }
}
```

If your client distinguishes transports explicitly, select **HTTP** /
**Streamable HTTP** (not stdio, not SSE-only). The server implements the current
Streamable HTTP transport.

## What a correct connection looks like

On `initialize`, the server reports its identity:

```json
{ "serverInfo": { "name": "zpay-hub", "version": "1.0.0" } }
```

A fresh session's `tools/list` returns exactly five tools: `connect_jaw`,
`connect_bitrefill`, `connect_swiggy`, `configure_permissions`, `buy`. After a
successful `connect_*`, a second `tools/list` returns additional namespaced
tools (`jaw__*`, `swiggy__*`, `bitrefill__*`).

## Probing with curl

You can confirm reachability without a full client. Initialize, then list tools:

```bash
curl -sN https://errand.philotheephilix.in/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18",
        "capabilities":{},
        "clientInfo":{"name":"curl","version":"0"}}}'
```

A valid response carries the `zpay-hub` `serverInfo` shown above.

## Next

Proceed to the [Quickstart](/install/quickstart/) to connect services and run a
purchase. Your client must honor `notifications/tools/list_changed` to see the
passthrough tools appear after `connect_*`; if it does not, re-list tools
manually after connecting.
