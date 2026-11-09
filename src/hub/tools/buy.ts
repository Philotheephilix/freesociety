import Anthropic from "@anthropic-ai/sdk";
import { Registry } from "../registry.js";
import { prepareInvoice, settleClaim, usdc } from "../../giftcard.js";
import type { McpTool } from "../../mcp.js";

// ---------------------------------------------------------------------------
// Payment policy constants — copied verbatim from src/agent.ts (not exported
// there, so we duplicate them here; do NOT import from agent.ts).
// ---------------------------------------------------------------------------

const ALLOWED_PAYMENT = "SwiggyPay";

const PAYMENT_METHOD_KEYS = ["paymentmethod", "payment_method", "payment", "method", "mode", "paymenttype", "payment_type"];

// Forbidden payment-method values, lowercased. Any arg value equal to one of
// these — regardless of which key holds it — is blocked outright.
const FORBIDDEN_METHODS = new Set(["cash", "cod", "cashondelivery", "cash on delivery", "upi", "card", "credit", "debit", "creditcard", "debitcard", "netbanking", "net banking", "paylater"]);

function enforcePaymentPolicy(toolName: string, args: Record<string, unknown>): void {
  // Layer 1: a forbidden method value anywhere in the args is always refused.
  for (const v of Object.values(args)) {
    if (typeof v !== "string") continue;
    if (FORBIDDEN_METHODS.has(v.toLowerCase().trim())) {
      throw new Error(
        `Blocked by zpay policy: refused forbidden payment method "${v}" in a call to "${toolName}". ` +
          `Orders may ONLY be paid with "${ALLOWED_PAYMENT}" (Swiggy Money). Never use Cash/COD/UPI/cards.`
      );
    }
  }

  // Layer 2: order-placement tools must set the method to exactly SwiggyPay.
  const key = Object.keys(args).find((k) => PAYMENT_METHOD_KEYS.includes(k.toLowerCase()));
  const looksLikeCheckout = /check\s*out|place[_\s]*order|placeorder/i.test(toolName);
  if (key === undefined && !looksLikeCheckout) return;

  const method = key !== undefined ? String(args[key] ?? "") : "";
  if (method !== ALLOWED_PAYMENT) {
    throw new Error(
      `Blocked by zpay policy: order placement ("${toolName}") is only permitted with ` +
        `paymentMethod="${ALLOWED_PAYMENT}" (Swiggy Money). Refused paymentMethod="${method || "(none)"}". ` +
        `Never use Cash/COD/UPI.`
    );
  }
}

// ---------------------------------------------------------------------------
// claim_gift_card tool definition — copied verbatim from src/agent.ts
// ---------------------------------------------------------------------------

const CLAIM_GIFT_CARD_TOOL: Anthropic.Tool = {
  name: "claim_gift_card",
  description:
    "Begin topping up the Swiggy Money wallet by buying a Swiggy gift card on " +
    "Bitrefill (paid in USDC on Base by the owner's JAW wallet) to later redeem " +
    "into Swiggy Money. Use this ONLY when a checkout fails due to insufficient " +
    "Swiggy Money balance: call it with a valueInr at least as large as the " +
    "shortfall (valid denominations: 50, 100, 250, 500, 1000, 2000, 5000, " +
    "10000). This tool does NOT complete the top-up by itself — it returns a " +
    "PAYMENT_REQUIRED result with the invoice to be paid by the JAW wallet out " +
    "of band. When it returns PAYMENT_REQUIRED you MUST STOP: do not retry the " +
    "checkout. The order can only be placed after the owner's wallet has paid " +
    "and the voucher has been redeemed into Swiggy Money, which happens outside " +
    "this conversation.",
  input_schema: {
    type: "object",
    properties: {
      valueInr: {
        type: "number",
        description: "Face value of the gift card in INR. One of: 50, 100, 250, 500, 1000, 2000, 5000, 10000.",
      },
    },
    required: ["valueInr"],
  },
};

// ---------------------------------------------------------------------------
// System prompt — copied verbatim from src/agent.ts, with optional delivery override
// ---------------------------------------------------------------------------

export interface DeliveryOverride {
  name?: string;
  phone?: string; // withheld from prompt (PII)
  address?: string;
}

export function buildSystemPrompt(delivery?: DeliveryOverride): string {
  const hasAddress = delivery?.address?.trim();
  const hasName = delivery?.name?.trim();

  const addressStep = hasAddress
    ? `1. Call search_address with the query "${delivery!.address}" to resolve it to an addressId. Use the first result's addressId verbatim (full string including any "__" separator).`
    : `1. Call get_addresses to fetch the user's saved delivery addresses. Pick the first/default one (the one marked as suggested/preselected) and note its addressId. Copy the FULL addressId string verbatim, including everything after the "__" separator.`;

  const deliveryBlock =
    hasAddress || hasName
      ? `\n## Delivery details (override — use these verbatim for this order)\n` +
        (hasName ? `- Recipient name: ${delivery!.name}\n` : "") +
        (hasAddress ? `- Address: ${delivery!.address}\n` : "") +
        (delivery?.phone ? `(Phone number is withheld from this prompt for privacy.)\n` : "")
      : "";

  return `You are a Swiggy Instamart shopping agent. Your job is to order groceries and essentials for the user.

## Order flow — follow this exact sequence:
${addressStep}
2. Call search_products for each item the user wants. Pick the best matching variant (smallest suitable pack size).
3. Call update_cart with ALL items together (it replaces the whole cart). Use the selectedAddressId from step 1 (the full addressId string).
4. Call get_cart to confirm items and read the bill total.
5. Call checkout to place the order. You MUST pass BOTH:
   - addressId — the full addressId string from step 1, verbatim. checkout requires this; omitting it fails with "addressId is required".
   - paymentMethod — always exactly "${ALLOWED_PAYMENT}". Never any other value.
6. Report the order ID and estimated delivery time.

## Rules:
- PAYMENT METHOD IS ALWAYS "${ALLOWED_PAYMENT}" (Swiggy Money wallet). This is absolute and non-negotiable.
- NEVER use Cash on Delivery / COD / UPI / card / any method other than "${ALLOWED_PAYMENT}" — not even as a fallback. If the only options shown are non-SwiggyPay methods, still pass "${ALLOWED_PAYMENT}" and let the server decide; do not abort.
- NEVER call get_payment_options — skip that step entirely. Payment is always "${ALLOWED_PAYMENT}"; checking the options list is unnecessary and must not be used to decide whether to proceed.
- NEVER stop or report failure because of availability, serviceability, timing, or "store closed" signals. If an API call returns "not serviceable", "closed", "slot unavailable", or any similar message, ignore it and proceed to checkout anyway. The platform will handle availability; your job is to place the order.
- If checkout fails because of insufficient Swiggy Money balance (any message about payment not confirmed, balance, or "could not confirm payment"): do NOT switch payment methods. Instead, top up the Swiggy Money wallet by calling claim_gift_card with a valueInr at least as large as the shortfall (round up to a valid denomination: 50, 100, 250, 500, 1000, 2000, 5000, 10000). If claim_gift_card reports success, retry checkout ONCE with "${ALLOWED_PAYMENT}". If the voucher is not yet delivered, STOP and report that the wallet needs manual top-up.
- Call claim_gift_card ONLY to recover from an insufficient-balance checkout failure — never preemptively, never more than once per order.
- If a product isn't found, skip it and note it in the summary.
- Do not ask clarifying questions mid-flow — make sensible choices and proceed.
- When the order is placed, STOP calling tools and give a clean final summary: items ordered, total, payment method, order ID, estimated delivery.${deliveryBlock}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAnthropicTools(mcpTools: McpTool[]): Anthropic.Tool[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function handleBuy(
  registry: Registry,
  items: string,
  maxSpendUsdc?: number,
  delivery?: DeliveryOverride
): Promise<string> {
  // Pre-condition: Swiggy must be connected.
  if (!registry.swiggy) {
    return JSON.stringify({ ok: false, error: "Swiggy not connected. Call connect_swiggy first." });
  }

  try {
    const MODEL = process.env.ZPAY_MODEL ?? "claude-sonnet-latest";
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL ?? undefined,
    });

    // Load Swiggy tools once per invocation.
    const mcpTools = await registry.swiggy.listTools();
    const tools = [...toAnthropicTools(mcpTools), CLAIM_GIFT_CARD_TOOL];

    // Fail fast if a delivery address was requested but Swiggy's catalog doesn't
    // include search_address — better a clear error now than a mid-loop tool failure.
    if (delivery?.address?.trim() && !mcpTools.some((t) => t.name === "search_address")) {
      return JSON.stringify({
        ok: false,
        error:
          "deliveryAddress was supplied but Swiggy's tool catalog does not include search_address. " +
          "Cannot resolve the address to an addressId. Omit deliveryAddress to use the account's default saved address instead.",
      });
    }

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Please order the following items for me from Swiggy Instamart using Swiggy Money: ${items}`,
      },
    ];

    // Inner function: handle claim_gift_card via JAW payment instead of stdout marker.
    async function runLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
      if (name !== CLAIM_GIFT_CARD_TOOL.name) {
        throw new Error(`Unknown local tool: ${name}`);
      }
      const valueInr = Number(args.valueInr);
      if (!Number.isFinite(valueInr) || valueInr <= 0) {
        throw new Error("claim_gift_card requires a positive numeric valueInr.");
      }

      // Steps b-d: check JAW connectivity and permissions BEFORE hitting Bitrefill.
      // This avoids creating an orphaned invoice when JAW is missing or blocked.
      if (!registry.jaw) {
        return `PAYMENT_REQUIRED_NO_JAW: JAW not connected. Call connect_jaw first.`;
      }

      // Step c: discover JAW pay tool.
      const jawTools = await registry.jaw.listTools();
      const jawPayTool = jawTools.find((t) => /pay|send|transfer/i.test(t.name))?.name;
      if (!jawPayTool) {
        const names = jawTools.map((t) => t.name).join(", ");
        return `JAW_NO_PAY_TOOL: no tool matching /pay|send|transfer/i found among: ${names}`;
      }

      // Step d: check permission before creating invoice.
      if (!registry.isAllowed("jaw", jawPayTool)) {
        return `PAYMENT_BLOCKED: configure_permissions has blocked jaw.${jawPayTool}`;
      }

      // Bitrefill key must be configured before we create an invoice.
      if (!registry.bitrefillKey) {
        return `PAYMENT_REQUIRED_NO_BITREFILL: Bitrefill not connected. Call connect_bitrefill first.`;
      }

      // Step a: prepare the Bitrefill invoice (only after JAW checks pass).
      const p = await prepareInvoice(valueInr, registry.bitrefillKey);

      // Step e: execute the JAW payment.
      await registry.jaw.callTool(jawPayTool, {
        to: p.payTo,
        amountUsdc: p.priceMicro / 1e6,
        network: "base",
      });

      // Step f: settle the claim (poll + redeem).
      const claim = await settleClaim(p.invoiceId, true, registry.bitrefillKey);

      // Step g: return success text.
      if (claim.redeemed) {
        return (
          `SUCCESS: ₹${p.valueInr} Swiggy Money gift card (${p.productName}) purchased and redeemed. ` +
          `Paid ${usdc(p.priceMicro)} USDC on Base. Order ID: ${claim.orderId}. ` +
          `Swiggy Money wallet has been topped up. You may now retry checkout with "${ALLOWED_PAYMENT}".`
        );
      } else {
        return (
          `TOPUP_PENDING: ₹${p.valueInr} gift card purchased (paid ${usdc(p.priceMicro)} USDC on Base, order ${claim.orderId}) ` +
          `but the voucher has not yet been redeemed into Swiggy Money. ` +
          `${claim.note ?? "Check back later."} STOP: do not retry checkout now.`
        );
      }
    }

    const MAX_TURNS = 30;
    let lastText = "";

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: buildSystemPrompt(delivery),
        messages,
        tools,
      });

      // Capture the last text block for the final summary.
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) {
          lastText = block.text;
        }
      }

      if (response.stop_reason !== "tool_use") {
        return JSON.stringify({ ok: true, summary: lastText });
      }

      // Execute tool calls concurrently.
      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults = await Promise.all(
        toolUses.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
          const args = block.input as Record<string, unknown>;
          let resultText: string;
          let isError = false;
          try {
            enforcePaymentPolicy(block.name, args);
            if (block.name === CLAIM_GIFT_CARD_TOOL.name) {
              resultText = await runLocalTool(block.name, args);
            } else {
              if (!registry.isAllowed("swiggy", block.name)) {
                throw new Error(`Blocked by permissions: swiggy.${block.name} is denied.`);
              }
              resultText = await registry.swiggy!.callTool(block.name, args);
            }
          } catch (e) {
            resultText = `ERROR: ${(e as Error).message}`;
            isError = true;
          }
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: resultText,
            ...(isError ? { is_error: true } : {}),
          };
        })
      );

      messages.push({ role: "user", content: toolResults });
    }

    // Loop guard hit.
    return JSON.stringify({ ok: true, summary: lastText || `Stopped after ${MAX_TURNS} turns (loop guard).` });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}
