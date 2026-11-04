// Passthrough tools: one hub tool per upstream tool, namespaced
// `${service}__${upstreamName}` to avoid clashing with the hub's own tools
// (connect_*, configure_permissions, buy).
//
// These are registered EAGERLY at session init from committed catalogs
// (catalogs/jaw.json, catalogs/swiggy.json) plus the hand-written Bitrefill
// defs, so the full tool list is visible in tools/list BEFORE any connect_*.
// A handler resolves the live upstream client from the registry at call time:
//   - service not connected  -> returns "connect <service> first"
//   - blocked by permissions  -> returns the permission error
//   - otherwise               -> forwards to the live client
// Because handlers read the registry per call, connecting a service upgrades
// every stub to a live passthrough with no re-registration.

import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BitrefillClient } from "../bitrefill.js";
import { Registry, type Service } from "./registry.js";
import { toZodShape } from "./jsonschema-to-zod.js";

const SEP = "__";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CatalogTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

function loadCatalog(service: "jaw" | "swiggy"): CatalogTool[] {
  try {
    return JSON.parse(
      readFileSync(join(__dirname, "catalogs", `${service}.json`), "utf8")
    ) as CatalogTool[];
  } catch {
    return [];
  }
}

function blockedText(service: Service, tool: string): string {
  return `ERROR: Blocked by permissions: ${service}.${tool} is denied. Use configure_permissions to allow it.`;
}

function notConnectedText(service: Service): string {
  return (
    `ERROR: ${service} is not connected in this session. ` +
    `Call connect_${service} first (accountId is required) — this tool is listed so you can discover it, ` +
    `but it only runs once its service is connected.`
  );
}

// ── MCP-backed services (jaw, swiggy) ────────────────────────────────────────

// Register every catalog tool for an MCP-backed service as a stub that resolves
// the live client at call time. Called once at session init.
function registerMcpCatalog(server: McpServer, registry: Registry, service: "swiggy" | "jaw"): number {
  const tools = loadCatalog(service);
  for (const tool of tools) {
    const handle = server.registerTool(
      `${service}${SEP}${tool.name}`,
      {
        description: tool.description ?? `${service} tool ${tool.name}`,
        inputSchema: toZodShape(tool.inputSchema),
      },
      async (args: Record<string, unknown>) => {
        const client = service === "jaw" ? registry.jaw : registry.swiggy;
        if (!client) {
          return { content: [{ type: "text" as const, text: notConnectedText(service) }] };
        }
        if (!registry.isAllowed(service, tool.name)) {
          return { content: [{ type: "text" as const, text: blockedText(service, tool.name) }] };
        }
        const text = await client.callTool(tool.name, args ?? {});
        return { content: [{ type: "text" as const, text }] };
      }
    );
    registry.registeredTools[service].push(handle);
  }
  return tools.length;
}

// ── Bitrefill (REST, not MCP) ────────────────────────────────────────────────

function registerBitrefillCatalog(server: McpServer, registry: Registry): number {
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

  const invoiceItem = z.object({
    product_id: z.string().describe("Bitrefill product id, e.g. \"swiggy-money-india\" for a Swiggy Money (India) gift card."),
    package_id: z.string().optional().describe("Specific package/SKU id when a product has multiple fixed denominations."),
    quantity: z.number().optional().describe("Number of units (default 1)."),
    value: z.number().optional().describe("Face value for range/denominated products, in the product's currency (e.g. INR 50/100/250/500/1000/2000/5000/10000 for Swiggy Money)."),
  });

  const defs: Array<{
    name: string;
    description: string;
    shape: z.ZodRawShape;
    run: (client: BitrefillClient, args: any) => Promise<unknown>;
  }> = [
    {
      name: "searchProducts",
      description:
        "Search the Bitrefill catalog for gift-card / voucher products. Returns products with their id, denominations and stock. For a Swiggy Money India card, search \"swiggy\" with country \"IN\" and pick product id \"swiggy-money-india\".",
      shape: {
        query: z.string().describe("Search text, e.g. \"swiggy\", \"amazon\"."),
        country: z.string().optional().describe("ISO country code to filter by, e.g. \"IN\" for India."),
      },
      run: (client, a) => client.searchProducts(a.query, a.country),
    },
    {
      name: "createInvoice",
      description:
        "Create a Bitrefill crypto invoice to buy one or more gift cards. Returns an invoice with a Base deposit address and a USDC amount: that amount must then be paid by a TOKEN TRANSFER (jaw_send_calls to the deposit address on Base), after which the invoice is polled and the voucher redeemed. Use paymentMethod \"usdc_base\" for USDC on Base.",
      shape: {
        items: z.array(invoiceItem).describe("Gift cards to buy; each needs product_id plus a package_id or value."),
        paymentMethod: z.string().describe("Crypto rail to pay with, e.g. \"usdc_base\" (USDC on Base)."),
      },
      run: (client, a) => client.createInvoice(a.items, a.paymentMethod),
    },
    {
      name: "getInvoice",
      description:
        "Fetch a Bitrefill invoice by id to check its status, payment state, and the orders it produced. Poll this after paying the invoice's deposit address to see when vouchers are delivered.",
      shape: { id: z.string().describe("Invoice id returned by createInvoice.") },
      run: (client, a) => client.getInvoice(a.id),
    },
    {
      name: "getOrder",
      description:
        "Fetch a single Bitrefill order by id, including delivery status and voucher/redemption details once delivered.",
      shape: { id: z.string().describe("Order id (found on an invoice's orders list).") },
      run: (client, a) => client.getOrder(a.id),
    },
  ];

  for (const def of defs) {
    const handle = server.registerTool(
      `bitrefill${SEP}${def.name}`,
      { description: def.description, inputSchema: def.shape },
      async (args: Record<string, unknown>) => {
        if (!registry.bitrefillKey) return ok(notConnectedText("bitrefill"));
        if (!registry.isAllowed("bitrefill", def.name)) return ok(blockedText("bitrefill", def.name));
        try {
          const result = await def.run(new BitrefillClient(registry.bitrefillKey), args);
          return ok(JSON.stringify(result));
        } catch (e) {
          return ok(`ERROR: ${(e as Error).message}`);
        }
      }
    );
    registry.registeredTools.bitrefill.push(handle);
  }
  return defs.length;
}

// ── Public API ───────────────────────────────────────────────────────────────

// Register the full passthrough catalog (jaw + swiggy + bitrefill) at session
// init, so every tool is visible in tools/list before any connect_*. Call once
// from buildServer.
export function registerAllCatalogs(server: McpServer, registry: Registry): number {
  let n = 0;
  n += registerMcpCatalog(server, registry, "jaw");
  n += registerMcpCatalog(server, registry, "swiggy");
  n += registerBitrefillCatalog(server, registry);
  return n;
}

// Called by the connect tools after a successful connection. The catalog tools
// are already registered and their handlers read the now-present client from
// the registry, so there is nothing to re-register — we only nudge clients to
// re-read (in case the catalog ever lagged the live tool set). Kept as the
// connect-time hook so server.ts need not change its call sites.
export async function registerServiceTools(
  server: McpServer,
  _registry: Registry,
  _service: Service
): Promise<number> {
  server.sendToolListChanged();
  return 0;
}
