import Anthropic from "@anthropic-ai/sdk";
import { getAccessToken } from "./auth.js";
import { McpClient, type McpTool } from "./mcp.js";
import { prepareInvoice, usdc } from "./giftcard.js";

// Claude Code injects ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL via its session env.
// When running as a standalone child process (npx tsx), pass them explicitly.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL ?? undefined,
});

const MODEL = process.env.ZPAY_MODEL ?? "claude-sonnet-latest";
const SWIGGY_MCP_URL = "https://mcp.swiggy.com/im";

// Payment policy: orders may ONLY be paid with the Swiggy Money wallet.
// This single constant feeds both the system prompt and the checkout guard,
// so the policy lives in exactly one place.
const ALLOWED_PAYMENT = "SwiggyPay";

// Single-line stdout marker the orchestrator greps for, followed by the
// PreparedInvoice JSON. Must be stable — the parent session matches on it.
const PAYMENT_MARKER = "@@ZPAY_PAYMENT_REQUIRED@@";

// Local (non-MCP) tool: top up Swiggy Money by buying a Swiggy gift card on
// Bitrefill and redeeming it on the emulator. The gift card is paid in USDC on
// Base by the owner's JAW wallet — NOT by this process. So this tool only
// PREPARES the Bitrefill invoice (deposit address + USDC amount) and reports a
// PAYMENT_REQUIRED result; the JAW orchestrator running this agent pays the
// invoice under the owner's spend-permission and then settles + redeems it.
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

// Dispatch a local tool call. Returns the result text (or throws).
async function runLocalTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name !== CLAIM_GIFT_CARD_TOOL.name) {
    throw new Error(`Unknown local tool: ${name}`);
  }
  const valueInr = Number(args.valueInr);
  if (!Number.isFinite(valueInr) || valueInr <= 0) {
    throw new Error("claim_gift_card requires a positive numeric valueInr.");
  }
  const p = await prepareInvoice(valueInr);
  // Emit a single-line, machine-parseable marker to stdout so the orchestrator
  // (the JAW-connected parent session) can pick up the invoice, pay it on Base,
  // and settle it. The prose return value is what the model sees.
  console.log(`${PAYMENT_MARKER} ${JSON.stringify(p)}`);
  return (
    `PAYMENT_REQUIRED: a Bitrefill invoice for ₹${p.valueInr} (${p.productName}) was created. ` +
    `The owner's JAW wallet must pay ${usdc(p.priceMicro)} on Base to ${p.payTo} ` +
    `(invoice ${p.invoiceId}), then the voucher is redeemed into Swiggy Money — all out of band. ` +
    `STOP now: do NOT retry checkout. The order cannot be placed until the top-up completes outside this conversation.`
  );
}

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

function toAnthropicTools(mcpTools: McpTool[]): Anthropic.Tool[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

async function runOrderAgent(items: string): Promise<void> {
  const accessToken = await getAccessToken();

  console.log("Connecting to Swiggy Instamart MCP...");
  const mcp = new McpClient(SWIGGY_MCP_URL, accessToken);
  await mcp.initialize();

  const mcpTools = await mcp.listTools();
  console.log(`Loaded ${mcpTools.length} Swiggy tools.`);
  const tools = [...toAnthropicTools(mcpTools), CLAIM_GIFT_CARD_TOOL];

  console.log(`\nOrdering: ${items}\n${"─".repeat(50)}`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Please order the following items for me from Swiggy Instamart using Swiggy Money: ${items}`,
    },
  ];

  const MAX_TURNS = 25;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    // Print any text the model emitted this turn.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(block.text);
      }
    }

    if (response.stop_reason !== "tool_use") {
      console.log(`\n${"─".repeat(50)}\nDone (${response.stop_reason}).`);
      return;
    }

    // Execute every tool_use block. Blocks in a single turn are independent
    // (e.g. several search_products), so run them concurrently.
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults = await Promise.all(
      toolUses.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        const args = block.input as Record<string, unknown>;
        console.log(`  → ${block.name}(${JSON.stringify(args).slice(0, 120)})`);
        let resultText: string;
        let isError = false;
        try {
          enforcePaymentPolicy(block.name, args);
          resultText =
            block.name === CLAIM_GIFT_CARD_TOOL.name
              ? await runLocalTool(block.name, args)
              : await mcp.callTool(block.name, args);
        } catch (e) {
          resultText = `ERROR: ${(e as Error).message}`;
          isError = true;
        }
        console.log(`    ← ${resultText.slice(0, 200)}${resultText.length > 200 ? "…" : ""}`);
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

  console.log(`\nStopped after ${MAX_TURNS} turns (loop guard).`);
}

// Policy gate: an order may only ever be paid with the Swiggy Money wallet.
// Enforced defensively in two layers, because the guard can't trust the model
// to call a tool literally named "checkout", nor trust the Swiggy MCP to name
// its payment argument a spelling we predicted:
//
//   Layer 1 (value blocklist) — scan EVERY argument value, under any key, for a
//   forbidden payment method (Cash/COD/UPI/card/netbanking/wallet-other). This
//   closes the hole where a differently-named placement tool passes the method
//   under an unanticipated key ("method"/"payment"/"mode"/…): we match the
//   value, not the key, so the key spelling doesn't matter.
//
//   Layer 2 (checkout enforcement) — for a tool that is named like a checkout or
//   carries a known payment-method key, require the method to be exactly
//   SwiggyPay (empty/absent fails closed).
//
// Either layer throws, feeding the error back to the model, which must stop.
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

const items = process.argv[2] ?? "milk, eggs, bread";
runOrderAgent(items).catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
