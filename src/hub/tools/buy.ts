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
// System prompt — copied verbatim from src/agent.ts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Swiggy Instamart shopping agent. Your job is to order groceries and essentials for the user.

## Order flow — follow this exact sequence:
1. Call get_addresses to fetch the user's saved delivery addresses. Pick the first/default one (the one marked as suggested/preselected) and note its addressId. Copy the FULL addressId string verbatim, including everything after the "__" separator.
2. Call search_products for each item the user wants. Pick the best matching variant (smallest suitable pack size).
3. Call update_cart with ALL items together (it replaces the whole cart). Use the selectedAddressId from step 1 (the full addressId string).
4. Call get_cart to confirm items and read the bill total.
5. Call get_payment_options to list available methods. Confirm "Swiggy Money" (id "${ALLOWED_PAYMENT}") is present.
6. Call checkout to place the order. You MUST pass BOTH:
   - addressId — the full addressId string from step 1, verbatim. checkout requires this; omitting it fails with "addressId is required".
   - paymentMethod — always exactly "${ALLOWED_PAYMENT}". Never any other value.
7. Report the order ID and estimated delivery time.

## Rules:
- PAYMENT METHOD IS ALWAYS "${ALLOWED_PAYMENT}" (Swiggy Money wallet). This is absolute.
- NEVER use Cash on Delivery / COD / "Cash". NEVER pass paymentMethod="Cash" or "COD" under any circumstances, even as a fallback or retry.
- NEVER use UPI, cards, or any method other than ${ALLOWED_PAYMENT}.
- If checkout fails because of insufficient Swiggy Money balance (any message about payment not confirmed, balance, or "could not confirm payment"): do NOT switch payment methods and do NOT retry with a different method. Instead, top up the Swiggy Money wallet by calling claim_gift_card with a valueInr at least as large as the shortfall (round up to a valid denomination: 50, 100, 250, 500, 1000, 2000, 5000, 10000). If claim_gift_card reports the top-up succeeded, retry checkout ONCE with "${ALLOWED_PAYMENT}". If it reports the voucher is not yet delivered (balance unchanged), STOP: report that the order was not placed and the wallet needs manual top-up.
- Call claim_gift_card ONLY to recover from an insufficient-balance checkout failure — never preemptively, and never more than once per order.
- If a product isn't found, skip it and note it in the summary.
- Do not ask clarifying questions mid-flow — make sensible choices and proceed.
- When the order is placed, STOP calling tools and give a clean final summary: items ordered, total, payment method, order ID, estimated delivery.`;

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
  maxSpendUsdc?: number
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

      // Step a: prepare the Bitrefill invoice.
      const p = await prepareInvoice(valueInr);

      // Step b: check JAW is connected.
      if (!registry.jaw) {
        return (
          `PAYMENT_REQUIRED_NO_JAW: JAW not connected. Call connect_jaw first.`
        );
      }

      // Step c: discover JAW pay tool.
      const jawTools = await registry.jaw.listTools();
      const jawPayTool = jawTools.find((t) => /pay|send|transfer/i.test(t.name))?.name;
      if (!jawPayTool) {
        const names = jawTools.map((t) => t.name).join(", ");
        return `JAW_NO_PAY_TOOL: no tool matching /pay|send|transfer/i found among: ${names}`;
      }

      // Step d: check permission.
      if (!registry.isAllowed("jaw", jawPayTool)) {
        return `PAYMENT_BLOCKED: configure_permissions has blocked jaw.${jawPayTool}`;
      }

      // Step e: execute the JAW payment.
      await registry.jaw.callTool(jawPayTool, {
        to: p.payTo,
        amountUsdc: p.priceMicro / 1e6,
        network: "base",
      });

      // Step f: settle the claim (poll + redeem).
      const claim = await settleClaim(p.invoiceId, true);

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
        system: SYSTEM_PROMPT,
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
            resultText =
              block.name === CLAIM_GIFT_CARD_TOOL.name
                ? await runLocalTool(block.name, args)
                : await registry.swiggy!.callTool(block.name, args);
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
