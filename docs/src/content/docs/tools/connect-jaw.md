---
title: connect_jaw
description: Connect the permissioned JAW wallet. Opens login and returns a login URL.
---

Brings the JAW permissioned wallet online for the session and registers every
JAW tool as a `jaw__*` passthrough tool.

## Parameters

None. `connect_jaw` takes no arguments. It triggers JAW's native browser OAuth
internally.

## Behaviour

1. Starts JAW's OAuth flow and auto-opens the login URL on the host.
2. Also returns the login URL in the result, so you can open it yourself if the
   browser did not launch.
3. Blocks until the callback completes (or the flow times out).
4. On success, stores the wallet client on the session registry and enumerates
   its tools, registering each as `jaw__<tool>`.

## Returns

A JSON string.

On success:

```json
{ "ok": true, "toolCount": 27, "loginUrl": "https://…" }
```

- `toolCount` — number of JAW tools now available as `jaw__*` passthrough tools.
- `loginUrl` — present when a URL was produced; open it to complete login.

On failure:

```json
{ "ok": false, "error": "<message>" }
```

## Mid-session token expiry

A later JAW call can return `401 invalid_token`. Recovery uses a **silent**
refresh that reuses the stored refresh token only — it never re-opens the
browser, so an unattended call fails fast instead of hanging on a login nobody
can complete. If a transfer poll 401s, the transaction is already broadcast:
call `connect_jaw` again, then re-poll the *same* transaction id. Never resubmit
the transfer — see [Safety guardrails](/overview/safety/).

## Next

With JAW connected, grant an on-chain spend cap before moving money unattended —
see [The permission layer](/overview/permissions/) — and browse the wallet tools
at [`jaw__*`](/internal/jaw/).
