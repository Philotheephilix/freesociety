---
title: The permission layer
description: How configure_permissions gates every upstream tool, and how on-chain wallet permissions set the real spend cap.
---

Errand has two distinct permission mechanisms. They operate at different layers
and solve different problems. Understand which is which before you wire an agent
to a live wallet.

## 1. Hub-level allow/deny — `configure_permissions`

Every passthrough tool checks the session registry before it forwards a call:

```text
jaw__<tool> called
   └─▶ registry.isAllowed("jaw", "<tool>") ?
          ├─ true  → forward to upstream, return result
          └─ false → return a blocked-tool error, forward nothing
```

`configure_permissions` writes `permissions[service][toolName] = true | false`.
This is a boolean on/off switch per individual upstream tool. Use it to remove a
capability from the agent entirely — for example, deny every JAW tool except the
ones a given task needs.

A tool with no explicit entry follows the service default. Set an explicit
`false` to be certain a tool cannot be called in this session.

See the [`configure_permissions` reference](/tools/configure-permissions/) for
the exact call shape.

## 2. On-chain spend cap — JAW wallet permissions

The hub-level switch cannot express "one USDC per day." A real spend limit is an
*on-chain* permission, granted through JAW itself. Because every JAW tool is now
exposed as a `jaw__*` passthrough tool, the agent can grant that permission
directly:

- **`jaw__jaw_grant_permissions`** with an `x402Budget` funds
  `jaw_session_x402_pay` — paid **web-service** calls, drawn with no per-call
  prompt.
- A **custom permission** (`calls` = a USDC `transfer`, `spends` = a daily cap)
  authorizes repeated transfers up to the cap through `jaw_session_execute`
  without a prompt each time.

:::caution
The x402 budget is **not** a transfer allowance. Granting an `x402Budget` does
not authorize an ERC-20 `transfer`. Paying a gift-card invoice is a transfer —
it goes through `jaw_send_calls` and prompts for owner approval every time,
unless you first grant a custom permission for it. Do not treat the two budgets
as interchangeable.
:::

## How they combine

For a locked-down agent:

1. Grant a **custom on-chain permission** with a small daily cap so transfers
   cannot exceed it even if the agent is compromised.
2. Use **`configure_permissions`** to deny every upstream tool the task does not
   need, shrinking the attack surface to the few tools in play.

The on-chain cap is the hard financial ceiling; the hub allow-list is the
capability surface. Continue to [Safety guardrails](/overview/safety/) for the
code-enforced invariants that sit underneath both.
