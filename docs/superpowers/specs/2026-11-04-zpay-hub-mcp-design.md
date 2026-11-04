# zpay Hub MCP — Design

## Intent & Why

Currently zpay has three separate concerns wired together by agent-level glue code:
- **Swiggy**: external MCP server at `https://mcp.swiggy.com/im`
- **Bitrefill**: direct HTTP API client (no MCP)
- **JAW**: real external MCP server (payment wallet)

The agent in `src/agent.ts` hard-codes all three, and payment flows out-of-band via a stdout marker that a parent Claude session must watch for.

Goal: replace this with a single MCP server (`src/hub/`) that any MCP client (Claude Code, another agent, a script) connects to once. The hub owns all sub-service connections internally. The caller uses high-level tools only.

## Goals

- One MCP endpoint, stdio transport (no HTTP server needed — `stdio` is idiomatic for local MCP)
- Tools exposed to caller: `connect_swiggy`, `connect_jaw`, `configure_permissions`, `buy`
- Swiggy, Bitrefill, JAW wired internally — caller never touches them directly
- `buy` routes the full end-to-end flow: Swiggy order → Bitrefill invoice (if top-up needed) → JAW payment → settle + redeem → confirm order
- No stdout marker hack; JAW is called as a proper MCP sub-client

## Non-Goals

- No HTTP/SSE transport (stdio only)
- No multi-user session isolation
- No persistent order history
- Don't change existing `src/agent.ts`, `src/bitrefill.ts`, etc. — hub reuses them as libraries

## Architecture

```
MCP Client (Claude Code / agent)
        |  stdio JSON-RPC
        v
  src/hub/server.ts          ← MCP server, exposes hub tools
        |
        ├── src/hub/registry.ts    ← holds connected sub-service clients + permissions
        ├── src/hub/tools/
        │     ├── connect.ts       ← connect_swiggy, connect_jaw tools
        │     ├── permissions.ts   ← configure_permissions tool
        │     └── buy.ts           ← buy tool (orchestrates the order flow)
        |
        ├── src/mcp.ts             ← existing McpClient (used for Swiggy + JAW)
        ├── src/bitrefill.ts       ← existing BitrefillClient
        ├── src/giftcard.ts        ← existing prepareInvoice / settleClaim
        └── src/auth.ts            ← existing getAccessToken (Swiggy OAuth)
```

## Tools Exposed

### `connect_swiggy`
- Triggers Swiggy OAuth flow (reuses `getAccessToken()` from `src/auth.ts`)
- Connects `McpClient` to `https://mcp.swiggy.com/im`
- Returns: `{ ok: true, toolCount: N }`

### `connect_jaw`
- Input: `{ url: string, token: string }`
- Connects `McpClient` to the JAW MCP server
- Returns: `{ ok: true, toolCount: N }`

### `configure_permissions`
- Input: `{ service: "swiggy" | "jaw" | "bitrefill", permissions: Record<string, boolean> }`
- Stored in registry; enforced before any sub-tool call
- Returns: `{ ok: true }`

### `buy`
- Input: `{ items: string, maxSpendUsdc?: number }`
- Runs the full order flow internally — same logic as `agent.ts` but:
  - Swiggy tools come from connected `McpClient` (not hard-coded URL)
  - When top-up needed: calls JAW MCP `pay_invoice` tool instead of emitting stdout marker
  - Streams progress as text content blocks
- Returns: `{ orderId: string, total: string, deliveryTime: string }` or error

## JAW Payment Interface

Hub calls JAW MCP with tool `pay_invoice` (or whatever tool name JAW exposes — hub discovers via `listTools()` and picks the one matching `/pay|send|transfer/i`).

Input it passes: `{ to: string, amountUsdc: number, network: "base" }`  
(derived from `PreparedInvoice.payTo` and `PreparedInvoice.priceMicro / 1e6`)

## Permissions Model

Simple allow/deny map stored in registry:
```ts
{ swiggy: { checkout: true }, jaw: { pay_invoice: true }, bitrefill: { create_invoice: true } }
```
Default: all `true`. `configure_permissions` can set any to `false` to block that sub-call.

## Transport

stdio — hub launched as `node dist/hub/server.js` (or `tsx src/hub/server.ts`). Client adds it to MCP config as a local process. No port, no auth token needed on the hub itself.

## Constraints

- TypeScript, ESM, same toolchain as existing code (`tsx`, `tsc`)
- `@modelcontextprotocol/sdk` for MCP server (add dependency)
- Reuse all existing src/*.ts files unchanged
- `buy` tool max 30 turns (same as agent loop guard)
- Payment denomination rounding: same set as agent (50,100,250,500,1000,2000,5000,10000 INR)
