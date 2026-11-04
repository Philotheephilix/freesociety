# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run hub          # start the zpay-hub MCP server (tsx src/hub/server.ts) on :3400, path /mcp
npm run order        # run the standalone Swiggy ordering agent (tsx src/agent.ts)
npm run giftcard     # run the gift-card CLI (tsx src/giftcard.ts) — needs a subcommand (below)
npm run build        # type-check + emit to dist/ (tsc)
npm run test:e2e     # hub integration test (tsx src/hub/integration.test.ts) — hits live services
```

Single unit test: run the `.test.ts` file directly with tsx, e.g.
`npx tsx src/hub/registry.test.ts`. Tests are plain tsx scripts (no Jest/Vitest
runner), so there is no test-name filter — the file is the unit of granularity.

Gift-card CLI subcommands:
```bash
npx tsx src/giftcard.ts --prepare <INR>     # create a Bitrefill USDC invoice; prints deposit addr + amount (does NOT pay)
npx tsx src/giftcard.ts --settle <invoiceId> # poll the (already-paid) invoice, redeem the voucher on the emulator
npx tsx src/giftcard.ts --order <orderId>    # re-check a delivered order and redeem (for delayed vouchers)
```

Type-check without emitting: `npx tsc --noEmit`.

## Architecture

The repo is one MCP **hub** plus the libraries it orchestrates. The hub
(`src/hub/`) is the product; `src/agent.ts` and `src/giftcard.ts` are
standalone entry points that predate it and share its lower-level modules.

### The hub is per-session and dynamic

`src/hub/server.ts` runs a Streamable-HTTP MCP server. It keys a fresh
`McpServer` + `Registry` off each `Mcp-Session-Id` (a new session is created
only on an `initialize` POST). The `Registry` (`src/hub/registry.ts`) holds that
session's connected clients (`swiggy`/`jaw` MCP clients, `bitrefillKey` REST
key), the per-service permission map, and the handles of dynamically-registered
tools.

Only **five** tools exist at connect time: `connect_swiggy`, `connect_jaw`,
`connect_bitrefill`, `configure_permissions`, `buy`. Everything else appears
**after** a successful `connect_*`: the passthrough layer
(`src/hub/passthrough.ts`) enumerates the upstream service's tools and registers
one hub tool per upstream tool, namespaced `${service}__${tool}` (SEP = `"__"`).
`McpServer` fires `notifications/tools/list_changed` so the client refreshes
mid-session. This is why the tool list a client sees is a function of what has
been connected — do not assume `jaw__*` / `swiggy__*` tools exist statically.
Bitrefill is REST, not MCP, so its four passthrough tools
(`searchProducts`/`createInvoice`/`getInvoice`/`getOrder`) are hand-written
rather than enumerated.

MCP tools require a Zod raw shape, but upstream services describe tools in JSON
Schema. `src/hub/jsonschema-to-zod.ts` converts the common subset; anything
unrecognised degrades to `z.any()` so forwarding never breaks on an exotic
schema.

### Two gates sit in front of every call

1. **Permissions.** Every passthrough handler consults
   `registry.isAllowed(service, toolName)`, which returns
   `permissions[service][toolName] ?? true` — **default ALLOW**. `buy` checks
   this too before forwarding to Swiggy or JAW. `configure_permissions` writes
   individual booleans, so an agent can block one upstream tool by its bare
   (un-namespaced) name.
2. **Payment policy (safety-critical).** `src/hub/tools/buy.ts` runs an LLM
   ordering loop and enforces `enforcePaymentPolicy` on every tool call: a
   forbidden method value (`cash`, `cod`, `upi`, `card`, …) anywhere in the args
   is refused outright, and any checkout-shaped tool must set the method to
   exactly `SwiggyPay`. These constants are **deliberately duplicated** from
   `src/agent.ts` (see the comment there) — do not refactor them into a shared
   import; the two paths are meant to be independent.

### Gift cards are a two-phase, out-of-band flow

A Swiggy gift card cannot be bought directly. `buy`'s `claim_gift_card` is a
**checkout-recovery path only** — it fires when a Swiggy order fails for
insufficient balance, never standalone. The actual money movement is split so no
single tool both creates an invoice and pays it:

- `prepareInvoice` (`src/giftcard.ts`) creates a Bitrefill USDC-on-Base invoice
  and returns the deposit address + amount. It does **not** pay.
- The **JAW wallet** pays that address out of band (a token transfer via
  `jaw_send_calls`, not an x402 web-service payment — these are different money
  rails; see `.claude/skills/zpay-hub/`).
- `settleClaim` polls the invoice, extracts the voucher, and redeems it by
  driving the Swiggy Android app on an emulator (`src/redeem.ts`). Redemption
  submits but cannot fully confirm the credit — it leaves a screenshot.

Inside `buy`, `handleBuy` runs this whole sequence itself (JAW-connectivity and
permission checks happen *before* the Bitrefill invoice is created, to avoid
orphaned invoices), but a `claim_gift_card` success still only unlocks **one**
retry of checkout.

### Money-movement invariants (enforced, don't weaken)

- Non-idempotent RPCs (anything that moves money) must **not** auto-retry —
  `McpClient` network-retry defaults exist for reads, but a double-send is a
  double-spend. Gift-card vouchers are cash: never log, print, commit, or post
  them.
- The hub trusts internal callers but gates at the service boundary. When adding
  a new service, register its passthrough tools through
  `registerServiceTools` so the permission gate and `list_changed` notification
  are wired consistently, rather than registering tools ad hoc.

## MCP client registration

`.mcp.json` registers the hub at `http://localhost:3400/mcp`. The hub itself is
the thing documented in `docs/` (an Astro Starlight site deployed to
`errand.philotheephilix.in`); `README.md` and `PRODUCT.md` carry the
product-level narrative and the permission-layer table.
