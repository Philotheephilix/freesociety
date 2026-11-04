---
title: jaw__* — the wallet
description: The JAW permissioned wallet tools, exposed as passthrough. Which tool moves money, and how.
---

After [`connect_jaw`](/tools/connect-jaw/), every JAW tool is available as a
`jaw__*` passthrough tool. The exact set is discovered at runtime from the
wallet (`listTools()`), so it tracks the connected wallet's capabilities. The
tools below are the ones that move money or set limits — know these cold before
wiring an agent to a live wallet.

## Which tool moves money — do not confuse these

| Action | Tool | Approval |
| --- | --- | --- |
| Pay a **paid web service** (an HTTP endpoint charging per call) | `jaw__jaw_session_x402_pay` | Drawn from the **x402 budget**, no prompt. |
| **Transfer tokens** (e.g. pay a Bitrefill deposit address) | `jaw__jaw_send_calls` | Per-transaction owner approval link, unless a custom permission allows it. |
| Repeated/unattended contract calls under a custom permission | `jaw__jaw_session_execute` | None — the permission itself is the limit. |

:::caution
The x402 budget is **not** a transfer allowance. `jaw__jaw_grant_permissions`
with an `x402Budget` funds only `jaw_session_x402_pay` (web services). It does
**not** authorize an ERC-20 `transfer`. Paying a gift-card invoice is a transfer
→ `jaw__jaw_send_calls` → prompts every time, unless you first grant a **custom
permission** (`calls` = a USDC `transfer`, `spends` = a daily cap).
:::

## Setting the spend cap

Grant a custom on-chain permission through `jaw__jaw_grant_permissions`:

- `calls` — a USDC `transfer` call authorization.
- `spends` — a daily cap.

This is the real financial ceiling. The hub-level allow/deny in
[`configure_permissions`](/tools/configure-permissions/) cannot express a dollar
limit; the on-chain permission can.

## The transfer flow on Base

Paying a deposit address (for example, a Bitrefill gift-card invoice):

1. `jaw__jaw_get_assets` (chainId `8453`) — confirm the USDC balance covers it.
2. `jaw__jaw_prepare_calls` — build `transfer(address,uint256)` to the USDC
   contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (amount in 6-decimal
   base units).
3. `jaw__jaw_simulate_calls` — if it fails `AA21 didn't pay prefund`, the wallet
   has no ETH for gas. Re-simulate with a USDC paymaster
   (`paymaster: { mode: "erc20", token: "0x8335…02913" }`); needs ≥ 0.5 USDC
   held.
4. `jaw__jaw_send_calls` — present the approval link clearly, with one sentence
   of what it moves.
5. `jaw__jaw_get_calls_status` (waitSeconds 30) — repeat while `awaiting_owner`
   or `sent`, until `landed`.

## Token expiry mid-flow

A poll can return `401 invalid_token`. The transaction is already broadcast —
do not resubmit. Call [`connect_jaw`](/tools/connect-jaw/) again, then re-poll
`jaw__jaw_get_calls_status` with the **same** id. Re-sending the transfer would
be a double-spend; the hub never auto-retries a money-moving RPC (see
[Safety guardrails](/overview/safety/)).

## Everything else

All other JAW tools (asset queries, call preparation, status) pass through the
same way and the same permission gate. Use
[`configure_permissions`](/tools/configure-permissions/) with `service: "jaw"`
to deny any tool a task does not need.
