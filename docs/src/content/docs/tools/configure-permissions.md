---
title: configure_permissions
description: Allow or deny individual upstream tools per service.
---

Sets hub-level allow/deny flags for a service's upstream tools. Every
passthrough tool consults these flags before forwarding a call.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `service` | `"swiggy"` \| `"jaw"` \| `"bitrefill"` | Yes | The service whose tools you are configuring. |
| `permissions` | object (`Record<string, boolean>`) | Yes | A map of upstream tool name → `true` (allow) or `false` (deny). |

The `permissions` keys are **bare** upstream tool names — not the namespaced
`jaw__*` form. For example, to deny JAW's `jaw_send_calls`, pass
`{ "jaw_send_calls": false }` with `service: "jaw"`.

## Example

```json
{
  "service": "jaw",
  "permissions": {
    "jaw_send_calls": false,
    "jaw_grant_permissions": true
  }
}
```

This denies direct transfers while keeping permission-granting available.

## Default behaviour

A tool with no explicit entry is **allowed** by default (`isAllowed` returns
`true` when unset). To be certain a tool cannot be called in a session, set it
explicitly to `false`. Settings apply to the current session's registry only and
do not persist across sessions.

## What this does and does not do

- **Does:** remove a capability from the agent at the hub layer. A denied tool
  returns a blocked-tool error and forwards nothing upstream.
- **Does not:** set a spending limit. A dollar cap is an *on-chain* JAW
  permission, granted through `jaw__jaw_grant_permissions`, not a boolean here.
  See [The permission layer](/overview/permissions/).

## Returns

A text result describing the applied permission changes.
