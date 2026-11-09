---
title: Cursor
description: Register the Errand MCP server in Cursor.
---

Cursor reads MCP servers from an `mcp.json` file. Add Errand as a remote
Streamable-HTTP server.

## Project scope

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "errand": {
      "url": "https://73e0-165-1-155-35.ngrok-free.app/mcp"
    }
  }
}
```

## Global scope

To make Errand available in every project, add the same entry to the global file
at `~/.cursor/mcp.json`.

## Verify

Open **Cursor Settings → MCP**. Errand should appear in the server list with a
green status and its five built-in tools: `connect_jaw`, `connect_bitrefill`,
`connect_swiggy`, `configure_permissions`, `buy`. If it shows a red status,
confirm the URL resolves and that your network can reach
`73e0-165-1-155-35.ngrok-free.app`.

## Next

Connect the services and run your first purchase — see the
[Quickstart](/install/quickstart/). When you call a `connect_*` tool, the new
`jaw__*` / `swiggy__*` / `bitrefill__*` tools appear after Cursor refreshes the
tool list.
