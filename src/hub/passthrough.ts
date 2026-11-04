// Dynamic passthrough: after a service connects, register one hub tool per
// upstream tool so the agent can call them directly. Tools are namespaced
// `${service}__${upstreamName}` to avoid clashing with the hub's own tools
// (connect_*, configure_permissions, buy). Every call is gated by
// registry.isAllowed(service, upstreamName), so configure_permissions can
// block individual upstream tools. Registering tools after the server has
// connected makes McpServer emit notifications/tools/list_changed, so clients
// refresh their tool list mid-session.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpClient } from "../mcp.js";
import { BitrefillClient } from "../bitrefill.js";
import { Registry, type Service } from "./registry.js";
import { toZodShape } from "./jsonschema-to-zod.js";

const SEP = "__";

function blockedText(service: Service, tool: string): string {
  return `ERROR: Blocked by permissions: ${service}.${tool} is denied. Use configure_permissions to allow it.`;
}

// Remove any passthrough tools previously registered for this service (used on
// reconnect so the tool list doesn't accumulate duplicates).
function clearService(registry: Registry, service: Service): void {
  for (const handle of registry.registeredTools[service]) {
    try {
      handle.remove();
    } catch {
      // already removed / server closing — ignore
    }
  }
  registry.registeredTools[service] = [];
}

// Register passthrough tools for an MCP-backed service (jaw or swiggy).
async function registerMcpService(
  server: McpServer,
  registry: Registry,
  service: "swiggy" | "jaw",
  client: McpClient
): Promise<number> {
  clearService(registry, service);
  const tools = await client.listTools();

  for (const tool of tools) {
    const handle = server.registerTool(
      `${service}${SEP}${tool.name}`,
      {
        description: tool.description ?? `${service} tool ${tool.name}`,
        inputSchema: toZodShape(tool.inputSchema),
      },
      async (args: Record<string, unknown>) => {
        if (!registry.isAllowed(service, tool.name)) {
          return { content: [{ type: "text" as const, text: blockedText(service, tool.name) }] };
        }
        const text = await client.callTool(tool.name, args ?? {});
        return { content: [{ type: "text" as const, text }] };
      }
    );
    registry.registeredTools[service].push(handle);
  }

  server.sendToolListChanged();
  return tools.length;
}

// Register passthrough tools for Bitrefill (a REST client, not MCP). We expose
// its public methods as individual hub tools with hand-written Zod shapes.
function registerBitrefillService(
  server: McpServer,
  registry: Registry,
  apiKey: string
): number {
  clearService(registry, "bitrefill");
  const client = new BitrefillClient(apiKey);

  const gate = (toolName: string) => registry.isAllowed("bitrefill", toolName);
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const blocked = (toolName: string) => ok(blockedText("bitrefill", toolName));

  const invoiceItem = z.object({
    product_id: z.string(),
    package_id: z.string().optional(),
    quantity: z.number().optional(),
    value: z.number().optional(),
  });

  const defs: Array<{
    name: string;
    description: string;
    shape: z.ZodRawShape;
    run: (args: any) => Promise<unknown>;
  }> = [
    {
      name: "searchProducts",
      description: "Search Bitrefill products. query is required; optional country ISO code (e.g. IN) filters results.",
      shape: { query: z.string(), country: z.string().optional() },
      run: (a) => client.searchProducts(a.query, a.country),
    },
    {
      name: "createInvoice",
      description: "Create a Bitrefill crypto invoice. items is a list of {product_id, package_id?, quantity?}; paymentMethod e.g. usdc_base.",
      shape: { items: z.array(invoiceItem), paymentMethod: z.string() },
      run: (a) => client.createInvoice(a.items, a.paymentMethod),
    },
    {
      name: "getInvoice",
      description: "Fetch a Bitrefill invoice by id (status, payment, orders).",
      shape: { id: z.string() },
      run: (a) => client.getInvoice(a.id),
    },
    {
      name: "getOrder",
      description: "Fetch a single Bitrefill order by id (status, redemption info).",
      shape: { id: z.string() },
      run: (a) => client.getOrder(a.id),
    },
  ];

  for (const def of defs) {
    const handle = server.registerTool(
      `bitrefill${SEP}${def.name}`,
      { description: def.description, inputSchema: def.shape },
      async (args: Record<string, unknown>) => {
        if (!gate(def.name)) return blocked(def.name);
        try {
          const result = await def.run(args);
          return ok(JSON.stringify(result));
        } catch (e) {
          return ok(`ERROR: ${(e as Error).message}`);
        }
      }
    );
    registry.registeredTools.bitrefill.push(handle);
  }

  server.sendToolListChanged();
  return defs.length;
}

// Public entry point used by the connect tools after a successful connection.
export async function registerServiceTools(
  server: McpServer,
  registry: Registry,
  service: Service
): Promise<number> {
  if (service === "bitrefill") {
    if (!registry.bitrefillKey) return 0;
    return registerBitrefillService(server, registry, registry.bitrefillKey);
  }
  const client = service === "jaw" ? registry.jaw : registry.swiggy;
  if (!client) return 0;
  return registerMcpService(server, registry, service, client);
}
