// Buy a Swiggy Money (India) gift card on Bitrefill and redeem it into the
// Swiggy Money wallet by driving the Swiggy app on the Android emulator.
//
// Payment is NOT done here. The JAW wallet is the payer: this module prepares a
// Bitrefill crypto invoice (USDC on Base) and returns the deposit address +
// amount, the JAW orchestrator pays it under the owner's spend-permission, and
// then this module polls the invoice and redeems the delivered voucher.
//
// Flow: prepareInvoice (search -> pick denomination -> create usdc_base invoice)
//       -> [JAW pays the deposit address] -> settleClaim (poll -> extract
//       code+PIN -> redeem on emulator).
//
// Usage: npx tsx src/giftcard.ts --prepare <value-in-INR>
//          -> prints the invoice id, deposit address and USDC amount to pay.
//        npx tsx src/giftcard.ts --settle <invoiceId>
//          -> polls the (already-paid) invoice and redeems it.
//        npx tsx src/giftcard.ts --order <orderId>
//          -> re-check a delivered order and redeem it.

import { BitrefillClient, type Invoice, type InvoiceOrder } from "./bitrefill.js";
import { parseVoucher, redeemOnEmulator, type VoucherCredentials } from "./redeem.js";

const PRODUCT_ID = "swiggy-money-india";
const COUNTRY = "IN";
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60_000; // 10 min for payment confirmation + delivery

const TERMINAL_OK = new Set(["complete", "all_delivered", "delivered"]);
const TERMINAL_BAD = new Set(["blocked", "denied", "payment_error", "expired"]);

// Terminal failure states on an individual order (distinct from the invoice
// status above): no voucher will ever arrive for these.
const ORDER_BAD = new Set(["failed", "refunded", "cancelled", "canceled"]);

// Format micro-USDC (6-decimal base units) as a human string, e.g. "0.55 USDC".
export function usdc(micro: number): string {
  return `${(micro / 1e6).toFixed(2)} USDC`;
}

// What prepareInvoice returns: everything the JAW payer needs to send USDC.
export interface PreparedInvoice {
  invoiceId: string;
  payTo: string; // Base deposit address to send USDC to
  priceMicro: number; // amount in micro-USDC (÷ 1e6 = USDC)
  valueInr: number;
  productName: string;
}

export interface ClaimResult {
  orderId: string;
  invoiceId?: string; // present when settling via invoice; absent on --order re-check
  valueInr: number;
  redeemed: boolean;
  voucher?: VoucherCredentials; // present once delivered
  note?: string; // e.g. delivery-delay message when not yet redeemable
}

// Step 1: create a Bitrefill invoice for a ₹value Swiggy card, payable in USDC
// on Base. Returns the deposit address + amount; does NOT pay.
export async function prepareInvoice(valueInr: number): Promise<PreparedInvoice> {
  const bitrefill = new BitrefillClient();

  console.log(`Searching Swiggy gift cards (India)...`);
  const products = await bitrefill.searchProducts("swiggy", COUNTRY);
  const product = products.find((p) => p.id === PRODUCT_ID) ?? products[0];
  if (!product) throw new Error("No Swiggy gift card found for India.");
  if (!product.in_stock) throw new Error(`${product.name} is out of stock.`);

  const pkg = product.packages?.find((p) => Number(p.value) === valueInr);
  if (!pkg) {
    const available = product.packages?.map((p) => p.value).join(", ");
    throw new Error(`No ₹${valueInr} denomination. Available: ${available ?? "none"}`);
  }
  console.log(`Selected: ${product.name} ₹${pkg.value} (${pkg.id})`);

  console.log(`Creating invoice (pay with USDC on Base)...`);
  const invoice = await bitrefill.createInvoice(
    [{ product_id: product.id, package_id: pkg.id, quantity: 1 }],
    "usdc_base"
  );
  const { address, price } = invoice.payment;
  console.log(`Invoice ${invoice.id}: pay ${usdc(price)} to ${address} (Base)`);

  return {
    invoiceId: invoice.id,
    payTo: address,
    priceMicro: price,
    valueInr,
    productName: product.name,
  };
}

async function pollInvoice(
  bitrefill: BitrefillClient,
  id: string
): Promise<Invoice> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const inv = await bitrefill.getInvoice(id);
    if (inv.status !== last) {
      console.log(`  invoice status: ${inv.status}`);
      last = inv.status;
    }
    if (TERMINAL_OK.has(inv.status)) return inv;
    if (TERMINAL_BAD.has(inv.status)) {
      throw new Error(`Invoice ${id} failed with status "${inv.status}"`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Invoice ${id} did not complete within ${POLL_TIMEOUT_MS / 60000} min`);
}

// Step 2: the invoice has been paid (by JAW). Poll until Bitrefill delivers,
// then extract the voucher and (optionally) redeem it on the emulator.
export async function settleClaim(
  invoiceId: string,
  redeem = true
): Promise<ClaimResult> {
  const bitrefill = new BitrefillClient();
  console.log(`Waiting for Bitrefill to confirm + deliver...`);
  const final = await pollInvoice(bitrefill, invoiceId);
  const order = final.orders[0];
  if (!order) throw new Error(`Invoice ${invoiceId} completed but returned no order.`);

  const base: ClaimResult = {
    orderId: order.id,
    invoiceId,
    valueInr: Number(order.product?.value ?? 0),
    redeemed: false,
  };
  return finishClaim(base, order, redeem);
}

// Given a delivered (or pending) order, extract the voucher and optionally
// redeem it on the emulator. Shared by settleClaim and the --order re-check.
async function finishClaim(
  base: ClaimResult,
  order: InvoiceOrder,
  redeem: boolean
): Promise<ClaimResult> {
  // A terminal failure on the order itself (failed/refunded/cancelled) means no
  // voucher is coming — don't blob-scan stale data or report it as "pending".
  if (ORDER_BAD.has(order.status)) {
    return {
      ...base,
      note: `Order ${order.id} ended as "${order.status}" — no voucher delivered. Nothing was redeemed.`,
    };
  }

  const voucher = parseVoucher(order.redemption_info);
  if (!voucher) {
    return {
      ...base,
      note:
        "Voucher not delivered yet (Swiggy vouchers can take 5-6 working days). " +
        `Re-check + redeem later with: npx tsx src/giftcard.ts --order ${order.id}`,
    };
  }

  console.log(`Voucher delivered: code ****${voucher.code.slice(-4)}, ${voucher.pin.length}-digit PIN.`);
  if (!redeem) return { ...base, voucher };

  console.log(`Redeeming into Swiggy Money on the emulator...`);
  await redeemOnEmulator(voucher);
  return { ...base, voucher, redeemed: true };
}

// Re-check a pending order and redeem it if now delivered.
async function checkOrder(orderId: string, redeem: boolean): Promise<void> {
  const bitrefill = new BitrefillClient();
  const order = await bitrefill.getOrder(orderId);
  console.log(`Order ${order.id} — ${order.status}`);
  const base: ClaimResult = {
    orderId: order.id,
    valueInr: Number(order.product?.value ?? 0),
    redeemed: false,
  };
  const result = await finishClaim(base, order, redeem);
  if (result.note) console.log(result.note);
  else if (result.redeemed) console.log(`Redeemed order ${order.id} into Swiggy Money.`);
}

// CLI entry point (skipped when imported as a module).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [mode, arg] = process.argv.slice(2);
  const fail = (e: unknown) => {
    console.error("\nError:", (e as Error).message ?? e);
    process.exit(1);
  };

  if (mode === "--prepare" && arg) {
    const value = Number(arg);
    if (!Number.isFinite(value) || value <= 0) fail("value must be a positive number");
    prepareInvoice(value)
      .then((p) => {
        console.log(`\n${"─".repeat(50)}`);
        console.log(JSON.stringify(p));
      })
      .catch(fail);
  } else if (mode === "--settle" && arg) {
    settleClaim(arg, true)
      .then((r) => {
        console.log(`\n${"─".repeat(50)}`);
        console.log(r.redeemed
          ? `Done. ₹${r.valueInr} redeemed into Swiggy Money (order ${r.orderId}).`
          : `Invoice ${r.invoiceId}: ${r.note ?? "not yet delivered"}`);
      })
      .catch(fail);
  } else if (mode === "--order" && arg) {
    checkOrder(arg, true).catch(fail);
  } else {
    console.error(
      "Usage:\n" +
        "  npx tsx src/giftcard.ts --prepare <value-in-INR>\n" +
        "  npx tsx src/giftcard.ts --settle  <invoiceId>\n" +
        "  npx tsx src/giftcard.ts --order   <orderId>"
    );
    process.exit(1);
  }
}
