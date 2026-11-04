---
title: connect_bitrefill
description: Connect Bitrefill with an API key, validated live and stored for reconnects.
---

Connects Bitrefill — the product catalog, invoicing, and settlement backend —
and registers the four `bitrefill__*` passthrough tools. Required before any
purchase or gift-card flow.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `apiKey` | string | No | Bitrefill API key. Pass it once to validate and store it. If omitted, a previously stored key is reused. |

## Behaviour

1. Uses the supplied `apiKey`, or falls back to a stored key
   (`~/.zpay/bitrefill.json` or the `BITREFILL_API_KEY` environment variable).
2. If no key is supplied and none is stored, fails with a clear message.
3. Validates the key with a lightweight authenticated call
   (`searchProducts("swiggy", "IN")`) before storing it.
4. On success, stores the key on the session registry, persists it for future
   reconnects, and registers the four `bitrefill__*` tools.

:::caution
A Bitrefill API key is a secret. Supply it through the `connect_bitrefill`
`apiKey` parameter only. It is never solicited through any other channel and
should never be pasted into shared transcripts or committed to a repository.
:::

## Returns

A JSON string.

On success:

```json
{ "ok": true, "stored": true }
```

On failure (no key available):

```json
{ "ok": false, "error": "No Bitrefill API key supplied and none stored. Pass apiKey once to save it." }
```

On failure (invalid key or network error):

```json
{ "ok": false, "error": "<message>" }
```

## Next

With Bitrefill connected, the four `bitrefill__*` tools are available — see
[`bitrefill__*`](/internal/bitrefill/). For gift cards, continue to the
[Gift-card CLI flow](/giftcard/overview/).
