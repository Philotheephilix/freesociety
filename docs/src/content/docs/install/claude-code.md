---
title: Claude Code
description: Register the Errand MCP server in Claude Code.
---

Claude Code speaks MCP natively. Add Errand as a remote Streamable-HTTP server.

## Add with the CLI

```bash
claude mcp add --transport http errand https://73e0-165-1-155-35.ngrok-free.app/mcp
```

This registers the server for the current project. To make it available in every
project, add it at user scope:

```bash
claude mcp add --transport http --scope user errand https://73e0-165-1-155-35.ngrok-free.app/mcp
```

## Or edit the config directly

Add an entry under `mcpServers` in your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "errand": {
      "type": "http",
      "url": "https://73e0-165-1-155-35.ngrok-free.app/mcp"
    }
  }
}
```

## Verify

List configured servers and confirm Errand is connected:

```bash
claude mcp list
```

Then, in a session, confirm the five built-in tools are present:
`connect_jaw`, `connect_bitrefill`, `connect_swiggy`, `configure_permissions`,
`buy`.

## Next

Connect the services and run your first purchase — see the
[Quickstart](/install/quickstart/). After you call a `connect_*` tool, Claude
Code picks up the new `jaw__*` / `swiggy__*` / `bitrefill__*` tools through the
`list_changed` notification without a restart.
