<!-- impeccable:product-schema 1 -->
# PRODUCT.md — Errand (zpay-hub)

## What it is
Errand is a Streamable-HTTP MCP server — "the hub" — that any MCP client (Claude
Code, Cursor, and other MCP-capable agents) connects to. It lets an autonomous
AI agent buy real products through Bitrefill, pay in crypto (USDC on Base), and
never spend past a cap enforced in code. It also claims gift cards that have no
Bitrefill API or website redemption path, by redeeming them automatically on a
cloud Android device.

Public endpoint: `https://errand.philotheephilix.in/mcp`
Server identity: `zpay-hub` v1.0.0. MCP path: `/mcp`.

## Platform
web (a documentation website). The docs are a separate static surface served by
Caddy at the domain root `https://errand.philotheephilix.in/`, while `/mcp`
continues to proxy to the live hub.

## Stack (docs surface)
Astro Starlight (static site generator), built to static HTML/CSS, served by
Caddy. Chosen for a GitBook-style persistent left sidebar, built-in search, and
a zero-runtime static output suitable for serving at a domain root.

## Users
Developers integrating the Errand MCP into AI tooling. They are technical, read
reference docs to find exact tool names, parameters, return shapes, and
permission semantics, and need copy-paste install config for their client. They
value precision and scanability over marketing.

## Surface being built
A formal, professional, developer-first documentation site. GitBook-like:
persistent left sidebar, clear navigation, full reference depth for every tool.
Mode: Read (comprehension and reference), not Persuade.

Required content:
- Overview / architecture (hub + dynamic passthrough model).
- Install guides for various AI tools (Claude Code, Cursor, generic MCP client).
- Full reference for the 5 built-in hub tools: `connect_swiggy`, `connect_jaw`,
  `connect_bitrefill`, `configure_permissions`, `buy`.
- Full reference for passthrough / internal tools: `jaw__*`, `swiggy__*`, and
  `bitrefill__*` (searchProducts, createInvoice, getInvoice, getOrder).
- The gift-card CLI (`src/giftcard.ts`: --prepare / --settle / --order).
- The permission + spend-cap layer and safety guardrails.

## Capabilities (tool inventory)
Built-in hub tools:
- `connect_swiggy` — connect Swiggy MCP (Instamart). No args. Registers `swiggy__*`.
- `connect_jaw` — connect JAW wallet via browser OAuth; returns a login URL.
  Registers `jaw__*`.
- `connect_bitrefill` — connect Bitrefill; optional `apiKey` (stored on first
  use). Registers `bitrefill__*`.
- `configure_permissions` — per-service, per-tool allow/deny booleans.
- `buy` — order Swiggy Instamart items end-to-end, paid in Swiggy Money, with an
  optional `maxSpendUsdc` cap.

Passthrough tools appear only after the matching connect succeeds, namespaced
`${service}__${tool}`, each gated by `configure_permissions`.

## Non-negotiable product truths (from safety design)
- Money-moving RPC is never auto-retried (double-spend risk).
- Credential refresh is silent (refresh token only); unattended runs fail fast.
- Codes are cash: vouchers are never logged, printed, committed, or posted.
- The spend cap is enforced before any invoice is created.
- Payment method for Instamart is always Swiggy Money; cash/COD/UPI/card are
  blocked.

## Voice / copy constraints
Formal, professional, developer-friendly. No AI-slop phrasing. No emojis
anywhere. Use SVG icons for visual affordance. The existing repo landing page
(`index.html`) is explicitly rejected as a visual reference.
