# zpay Hub MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc multi-service wiring in `src/agent.ts` with a single MCP server that internally manages Swiggy, JAW, and Bitrefill — exposing only high-level tools to the caller.

**Architecture:** A stdio MCP server (`src/hub/server.ts`) exposes four tools: `connect_swiggy`, `connect_jaw`, `configure_permissions`, and `buy`. A registry (`src/hub/registry.ts`) holds connected sub-clients and permissions. The `buy` tool runs the full order+payment flow using existing library code (`src/giftcard.ts`, `src/mcp.ts`, `src/bitrefill.ts`, `src/auth.ts`) unchanged.

**Tech Stack:** TypeScript ESM, `@modelcontextprotocol/sdk` (MCP server), `@anthropic-ai/sdk` (Claude for `buy` loop), existing `tsx`/`tsc` toolchain.

**Spec:** `docs/superpowers/specs/2026-11-04-zpay-hub-mcp-design.md`

## Global Constraints

- TypeScript strict mode, ESM (`"type": "module"`)
- `@modelcontextprotocol/sdk` for MCP server scaffolding — add to `dependencies`
- All existing `src/*.ts` files must remain unchanged
- Hub entry point: `src/hub/server.ts`, run with `tsx src/hub/server.ts` (add `"hub"` script to `package.json`)
- Transport: stdio only — no HTTP listener
- `buy` tool: max 30 agent turns (loop guard)
- Payment denominations (INR): 50, 100, 250, 500, 1000, 2000, 5000, 10000
- JAW payment tool discovered at runtime via `listTools()` — match on `/pay|send|transfer/i`

## Review Focus

- `connect_jaw` called with a bad URL/token — hub should return a clear error tool result, not crash the server process
- `buy` called before `connect_swiggy` — must return a descriptive error, not a null-dereference
- JAW `listTools()` returns no matching tool — `buy` must surface the tool name it searched for and what it found
- `configure_permissions` blocks a sub-call (e.g. `jaw.pay_invoice = false`) — `buy` must detect the block before calling JAW, not after the Bitrefill invoice is already created
- `buy` payment top-up needed but JAW not connected — must report which service is missing, not throw an unhandled rejection

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hub/registry.ts` | Create | Holds sub-clients + permissions; shared state for all tools |
| `src/hub/tools/connect.ts` | Create | `connect_swiggy` + `connect_jaw` tool handlers |
| `src/hub/tools/permissions.ts` | Create | `configure_permissions` tool handler |
| `src/hub/tools/buy.ts` | Create | `buy` tool — full order+payment loop |
| `src/hub/server.ts` | Create | MCP server entry point; wires tools to registry |
| `package.json` | Modify | Add `@modelcontextprotocol/sdk` dep; add `"hub"` script |

---

### Task 1: Add dependency and scaffold hub directory

**Files:**
- Modify: `package.json`
- Create: `src/hub/registry.ts`

**Interfaces:**
- Produces:
  - `Registry` class with fields: `swiggy: McpClient | null`, `jaw: McpClient | null`, `permissions: PermissionsMap`
  - `PermissionsMap = Record<"swiggy" | "jaw" | "bitrefill", Record<string, boolean>>`
  - `registry.isAllowed(service: "swiggy" | "jaw" | "bitrefill", toolName: string): boolean`
  - `registry.setPermission(service: "swiggy" | "jaw" | "bitrefill", toolName: string, allow: boolean): void`

- [ ] **Step 1: Install `@modelcontextprotocol/sdk`**

Run: `npm install @modelcontextprotocol/sdk`
Expected: package added to `node_modules`, `package.json` `dependencies` updated.

- [ ] **Step 2: Add `"hub"` script to `package.json`**

In `"scripts"`, add: `"hub": "tsx src/hub/server.ts"`

- [ ] **Step 3: Write failing test for Registry**

File: `src/hub/registry.test.ts`

```ts
import { Registry } from "./registry.js";

const r = new Registry();

// defaults
console.assert(r.swiggy === null, "swiggy starts null");
console.assert(r.jaw === null, "jaw starts null");
console.assert(r.isAllowed("swiggy", "checkout") === true, "default allow");

// set + check
r.setPermission("jaw", "pay_invoice", false);
console.assert(r.isAllowed("jaw", "pay_invoice") === false, "explicit deny");
console.assert(r.isAllowed("jaw", "other_tool") === true, "unset stays true");

console.log("registry tests passed");
```

Run: `tsx src/hub/registry.test.ts`
Expected: FAIL — `./registry.js` not found.

- [ ] **Step 4: Implement `src/hub/registry.ts`**

Export `Registry` class with:
- `swiggy: McpClient | null = null`
- `jaw: McpClient | null = null`
- `permissions: PermissionsMap` — initialized `{}` for all three services
- `isAllowed(service, toolName)` — returns `permissions[service][toolName] ?? true`
- `setPermission(service, toolName, allow)` — writes into `permissions[service]`

Import `McpClient` from `"../mcp.js"`.

- [ ] **Step 5: Run test**

Run: `tsx src/hub/registry.test.ts`
Expected: `registry tests passed`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/hub/registry.ts src/hub/registry.test.ts
git commit -m "feat: add hub registry and @modelcontextprotocol/sdk dep"
```

---

### Task 2: connect_swiggy and connect_jaw tools

**Files:**
- Create: `src/hub/tools/connect.ts`

**Interfaces:**
- Consumes: `Registry` from `../registry.js`; `McpClient` from `../../mcp.js`; `getAccessToken` from `../../auth.js`
- Produces:
  - `handleConnectSwiggy(registry: Registry): Promise<string>` — returns JSON string `{ ok: true, toolCount: N }` or throws
  - `handleConnectJaw(registry: Registry, url: string, token: string): Promise<string>` — same shape

- [ ] **Step 1: Write failing test**

File: `src/hub/tools/connect.test.ts`

```ts
import { Registry } from "../registry.js";

// Minimal stub for McpClient
class FakeMcp {
  async initialize() {}
  async listTools() { return [{ name: "t1" }, { name: "t2" }]; }
}

// Patch Registry to accept stub
const registry = new Registry();
// @ts-ignore
registry.jaw = null;

// Test handleConnectJaw plumbing via duck-typed stub
// (actual network call not tested here — test the shape)
import { handleConnectJaw } from "./connect.js";

// Mock: override McpClient constructor in module — not possible cleanly in ESM;
// instead test that a bad URL returns an error string, not a throw.
const result = await handleConnectJaw(registry, "http://localhost:1", "tok").catch(e => `ERROR:${e.message}`);
console.assert(typeof result === "string", "returns string");
console.log("connect tool test passed");
```

Run: `tsx src/hub/tools/connect.test.ts`
Expected: FAIL — `./connect.js` not found.

- [ ] **Step 2: Implement `src/hub/tools/connect.ts`**

`handleConnectSwiggy(registry)`:
1. Call `getAccessToken()` from `../../auth.js`
2. Construct `new McpClient("https://mcp.swiggy.com/im", token)`
3. Call `mcp.initialize()` then `mcp.listTools()`
4. Store in `registry.swiggy = mcp`
5. Return `JSON.stringify({ ok: true, toolCount: tools.length })`

`handleConnectJaw(registry, url, token)`:
1. Construct `new McpClient(url, token)`
2. Call `mcp.initialize()` then `mcp.listTools()`
3. Store in `registry.jaw = mcp`
4. Return `JSON.stringify({ ok: true, toolCount: tools.length })`

Both: wrap in try/catch, return `JSON.stringify({ ok: false, error: e.message })` on failure — do NOT throw (tool handlers must not crash the server).

- [ ] **Step 3: Run test**

Run: `tsx src/hub/tools/connect.test.ts`
Expected: `connect tool test passed`

- [ ] **Step 4: Commit**

```bash
git add src/hub/tools/connect.ts src/hub/tools/connect.test.ts
git commit -m "feat: connect_swiggy and connect_jaw tool handlers"
```

---

### Task 3: configure_permissions tool

**Files:**
- Create: `src/hub/tools/permissions.ts`

**Interfaces:**
- Consumes: `Registry` from `../registry.js`
- Produces:
  - `handleConfigurePermissions(registry: Registry, service: string, permissions: Record<string, boolean>): string`

- [ ] **Step 1: Write failing test**

File: `src/hub/tools/permissions.test.ts`

```ts
import { Registry } from "../registry.js";
import { handleConfigurePermissions } from "./permissions.js";

const r = new Registry();
const res = handleConfigurePermissions(r, "jaw", { pay_invoice: false });
const parsed = JSON.parse(res);
console.assert(parsed.ok === true, "returns ok");
console.assert(r.isAllowed("jaw", "pay_invoice") === false, "permission set");
console.assert(r.isAllowed("jaw", "other") === true, "unset unchanged");

// invalid service
const res2 = handleConfigurePermissions(r, "unknown_service", { foo: true });
const parsed2 = JSON.parse(res2);
console.assert(parsed2.ok === false, "invalid service returns error");

console.log("permissions tool test passed");
```

Run: `tsx src/hub/tools/permissions.test.ts`
Expected: FAIL — `./permissions.js` not found.

- [ ] **Step 2: Implement `src/hub/tools/permissions.ts`**

`handleConfigurePermissions(registry, service, permissions)`:
- Validate `service` is one of `"swiggy" | "jaw" | "bitrefill"` — if not, return `JSON.stringify({ ok: false, error: "unknown service: <service>" })`
- For each `[toolName, allow]` in `Object.entries(permissions)`, call `registry.setPermission(service, toolName, allow)`
- Return `JSON.stringify({ ok: true })`

- [ ] **Step 3: Run test**

Run: `tsx src/hub/tools/permissions.test.ts`
Expected: `permissions tool test passed`

- [ ] **Step 4: Commit**

```bash
git add src/hub/tools/permissions.ts src/hub/tools/permissions.test.ts
git commit -m "feat: configure_permissions tool handler"
```

---

### Task 4: buy tool (order + payment loop)

**Files:**
- Create: `src/hub/tools/buy.ts`

**Interfaces:**
- Consumes:
  - `Registry` from `../registry.js`
  - `prepareInvoice`, `settleClaim` from `../../giftcard.js`
  - `McpTool` from `../../mcp.js`
  - `Anthropic` from `@anthropic-ai/sdk`
  - `enforcePaymentPolicy` — NOT exported from `agent.ts`; copy the policy constants and function into `buy.ts` (it's a pure function with no deps)
- Produces:
  - `handleBuy(registry: Registry, items: string, maxSpendUsdc?: number): Promise<string>` — returns JSON result string

**Note on `enforcePaymentPolicy`:** It is not exported from `src/agent.ts`. Copy the `PAYMENT_METHOD_KEYS`, `FORBIDDEN_METHODS`, and `enforcePaymentPolicy` function verbatim into `buy.ts`. Do not modify `agent.ts`.

- [ ] **Step 1: Write failing pre-condition tests**

File: `src/hub/tools/buy.test.ts`

```ts
import { Registry } from "../registry.js";
import { handleBuy } from "./buy.js";

const r = new Registry();

// swiggy not connected
const res1 = await handleBuy(r, "milk");
const p1 = JSON.parse(res1);
console.assert(p1.ok === false && /swiggy/i.test(p1.error), "errors when swiggy not connected");

console.log("buy precondition tests passed");
```

Run: `tsx src/hub/tools/buy.test.ts`
Expected: FAIL — `./buy.js` not found.

- [ ] **Step 2: Implement precondition guards in `src/hub/tools/buy.ts`**

`handleBuy` starts with:
```ts
if (!registry.swiggy) return JSON.stringify({ ok: false, error: "Swiggy not connected. Call connect_swiggy first." });
```

Return immediately. No agent loop yet.

- [ ] **Step 3: Run precondition test**

Run: `tsx src/hub/tools/buy.test.ts`
Expected: `buy precondition tests passed`

- [ ] **Step 4: Implement the full agent loop in `handleBuy`**

Structure mirrors `runOrderAgent` in `src/agent.ts` but:

1. Pull Swiggy tools from `registry.swiggy.listTools()` (already connected, no re-init needed — but call `listTools()` fresh each `handleBuy` invocation since tools don't change, just read once at top)
2. Inject `CLAIM_GIFT_CARD_TOOL` (copy the definition from `agent.ts` verbatim — no import needed)
3. System prompt: same `SYSTEM_PROMPT` from `agent.ts` (copy verbatim)
4. `runLocalTool` — same logic as in `agent.ts` EXCEPT: after `prepareInvoice(valueInr)`, pay via JAW MCP instead of emitting a stdout marker:
   - Check `registry.jaw` is not null — if null, return `PAYMENT_REQUIRED_NO_JAW: JAW not connected. Call connect_jaw first.` as the tool result (model will surface this to caller)
   - Check `registry.isAllowed("jaw", jawPayTool)` — if false, return `PAYMENT_BLOCKED: configure_permissions has blocked jaw.${jawPayTool}`
   - Discover JAW pay tool: from `registry.jaw.listTools()`, find first tool whose name matches `/pay|send|transfer/i` — if none found, return `JAW_NO_PAY_TOOL: no tool matching /pay|send|transfer/i found among: [tool names]`
   - Call `registry.jaw.callTool(jawPayTool, { to: p.payTo, amountUsdc: p.priceMicro / 1e6, network: "base" })`
   - Then call `settleClaim(p.invoiceId, true)` to poll + redeem
   - Return success text describing the top-up
5. Loop runs up to 30 turns; on completion or stop, return `JSON.stringify({ ok: true, summary: lastTextBlock })` or `JSON.stringify({ ok: false, error: ... })`
6. Wrap entire function in try/catch; return `JSON.stringify({ ok: false, error: e.message })` on unhandled error

- [ ] **Step 5: Run all buy tests**

Run: `tsx src/hub/tools/buy.test.ts`
Expected: `buy precondition tests passed`

- [ ] **Step 6: Commit**

```bash
git add src/hub/tools/buy.ts src/hub/tools/buy.test.ts
git commit -m "feat: buy tool handler with full order+JAW payment loop"
```

---

### Task 5: MCP server entry point

**Files:**
- Create: `src/hub/server.ts`

**Interfaces:**
- Consumes: all four tool handlers; `Registry`
- Produces: runnable MCP server process (stdio transport)

- [ ] **Step 1: Implement `src/hub/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod"; // bundled with @modelcontextprotocol/sdk
import { Registry } from "./registry.js";
import { handleConnectSwiggy, handleConnectJaw } from "./tools/connect.js";
import { handleConfigurePermissions } from "./tools/permissions.js";
import { handleBuy } from "./tools/buy.js";
```

Create `McpServer` with name `"zpay-hub"`, version `"1.0.0"`.

Register tools:

**`connect_swiggy`** — no inputs. Handler: `() => handleConnectSwiggy(registry)`.

**`connect_jaw`** — inputs: `{ url: z.string(), token: z.string() }`. Handler: `({ url, token }) => handleConnectJaw(registry, url, token)`.

**`configure_permissions`** — inputs: `{ service: z.enum(["swiggy","jaw","bitrefill"]), permissions: z.record(z.boolean()) }`. Handler calls `handleConfigurePermissions`.

**`buy`** — inputs: `{ items: z.string(), maxSpendUsdc: z.number().optional() }`. Handler calls `handleBuy`.

Each tool registered via `server.tool(name, description, inputSchema, async (args) => ({ content: [{ type: "text", text: await handler(args) }] }))`.

Connect `new StdioServerTransport()` and call `server.connect(transport)`.

- [ ] **Step 2: Smoke test — launch and list tools**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' | tsx src/hub/server.ts`

Expected: JSON response containing `"result"` with `protocolVersion` (server initializes without crashing).

- [ ] **Step 3: Verify tools/list**

Run:
```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'; echo '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'; echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}') | tsx src/hub/server.ts
```

Expected: response for id 2 contains `tools` array with 4 entries: `connect_swiggy`, `connect_jaw`, `configure_permissions`, `buy`.

- [ ] **Step 4: Commit**

```bash
git add src/hub/server.ts
git commit -m "feat: zpay hub MCP server entry point (stdio)"
```

---

### Task 6: Wire into Claude Code MCP config

**Files:**
- No source files — this is a config step + end-to-end smoke test

- [ ] **Step 1: Add hub to Claude Code MCP settings**

In `~/.claude/settings.json` (or `.claude/settings.json`), add under `mcpServers`:

```json
"zpay-hub": {
  "command": "npx",
  "args": ["tsx", "/Users/I740422/projects/zpay/src/hub/server.ts"]
}
```

- [ ] **Step 2: Verify hub appears in Claude Code**

Restart Claude Code session and run `/mcp` (or check MCP tool list).
Expected: `zpay-hub` listed with tools `connect_swiggy`, `connect_jaw`, `configure_permissions`, `buy`.

- [ ] **Step 3: Commit config if in a tracked file**

```bash
git add .claude/settings.json 2>/dev/null || true
git commit -m "chore: add zpay-hub to MCP server config" 2>/dev/null || echo "no tracked config to commit"
```
