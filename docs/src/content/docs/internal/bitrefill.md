---
title: bitrefill__* — fulfillment and settlement
description: The four Bitrefill passthrough tools — search products, create invoices, and track them.
---

Bitrefill is a REST service, not an MCP server, so after
[`connect_bitrefill`](/tools/connect-bitrefill/) the hub exposes four
hand-written `bitrefill__*` tools. Each is gated by the same permission layer as
every other passthrough tool and returns the upstream result as JSON text.

## `bitrefill__searchProducts`

Search the Bitrefill catalog.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | Yes | Search term. |
| `country` | string | No | ISO country code (e.g. `IN`) to filter results. |

Returns the matching products, including the `product_id` and `package_id`
values you pass to `createInvoice`.

## `bitrefill__createInvoice`

Create a crypto invoice for one or more products.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `items` | array of items | Yes | Each item: `{ product_id, package_id?, quantity?, value? }`. |
| `paymentMethod` | string | Yes | Payment rail, e.g. `usdc_base`. |

Item fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `product_id` | string | Yes | From `searchProducts`. |
| `package_id` | string | No | A specific package/denomination. |
| `quantity` | number | No | How many. |
| `value` | number | No | Face value, for value-selectable products. |

Returns the invoice, including its id and the crypto deposit address to pay.

:::caution
Paying the invoice's deposit address is a **token transfer** — use
`jaw__jaw_send_calls`, not x402. See [`jaw__*`](/internal/jaw/) for the transfer
flow, and never auto-retry a timed-out transfer (double-spend risk).
:::

## `bitrefill__getInvoice`

Fetch an invoice by id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The invoice id. |

Returns status, payment state, and the orders created from the invoice.

## `bitrefill__getOrder`

Fetch a single order by id.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | Yes | The order id. |

Returns the order status and redemption info. Use this to poll for a delivered
voucher — Swiggy Money cards can take time to arrive after payment.

## Errors

A failed call returns `ERROR: <message>` as text rather than throwing, so the
agent can read and react to it. A denied tool returns the standard
blocked-permission error (see [The passthrough model](/internal/passthrough/)).

## Gift cards

For the full prepare → pay → settle gift-card workflow built on these tools, see
the [Gift-card CLI](/giftcard/overview/).
