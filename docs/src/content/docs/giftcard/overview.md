---
title: Gift-card CLI — prepare, pay, settle
description: Buy a Swiggy Money gift card on Bitrefill, pay it from JAW, and redeem it on a cloud device.
---

Gift cards are not a `buy` product and have no "buy a gift card" MCP tool. They
go through a three-step CLI flow: **prepare** an invoice, **pay** its deposit
address from the JAW wallet, then **settle** — poll Bitrefill and redeem the
delivered voucher into Swiggy Money on a cloud Android device.

:::caution
Connect Bitrefill first ([`connect_bitrefill`](/tools/connect-bitrefill/)).
Without it the flow — and the `buy` top-up path — returns
`PAYMENT_REQUIRED_NO_BITREFILL`.
:::

## 1. Prepare the invoice

```bash
npx tsx src/giftcard.ts --prepare <INR>
```

Valid denominations (INR): **50, 100, 250, 500, 1000, 2000, 5000, 10000**. A
value with no matching package is rejected with the available list.

It searches Swiggy gift cards for India, selects the matching package, and
creates a `usdc_base` invoice. It prints the invoice id, the Base deposit
address, and the USDC amount — and, on the final line, a JSON object with
everything the payer needs:

```text
Invoice <id>: pay <amount> USDC to <address> (Base)
──────────────────────────────────────────────────
{"invoiceId":"…","valueInr":500,"address":"0x…","priceMicro":…}
```

## 2. Pay the deposit address from JAW

Paying the deposit address is a **token transfer**, so it uses
`jaw__jaw_send_calls` — not x402. Follow the transfer flow in
[`jaw__*`](/internal/jaw/): check assets on chain `8453`, prepare the USDC
`transfer`, simulate (add the USDC paymaster if the wallet has no ETH for gas),
send, then poll status until `landed`.

## 3. Settle

```bash
npx tsx src/giftcard.ts --settle <invoiceId>
```

This can take up to ~10 minutes, so run it in the background. It waits for
Bitrefill to confirm payment and deliver the voucher, then redeems the voucher
into Swiggy Money on the emulator.

```text
Done. ₹500 redeemed into Swiggy Money (order <orderId>).
```

## If the voucher is not delivered yet

Swiggy cards can take time — sometimes days — to deliver. Re-check and redeem
later by order id:

```bash
npx tsx src/giftcard.ts --order <orderId>
```

## Confirming the credit

Redemption submits on the emulator but cannot always confirm the final credit
programmatically. The run points you at a screenshot
(`/tmp/zpay-redeem-result.png`) rather than printing the raw voucher. Codes are
cash — the voucher code and PIN are never printed in full, logged, or committed
(see [Safety guardrails](/overview/safety/)).
