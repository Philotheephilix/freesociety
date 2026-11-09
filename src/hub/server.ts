import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Registry } from "./registry.js";
import { handleConnectSwiggy, handleConnectJaw, handleConnectBitrefill } from "./tools/connect.js";
import { handleConfigurePermissions } from "./tools/permissions.js";
import { handleBuy } from "./tools/buy.js";
import type { DeliveryOverride } from "./tools/buy.js";
import { registerServiceTools, registerAllCatalogs } from "./passthrough.js";

const SERVICES = ["swiggy", "jaw", "bitrefill"] as const;

// Did a connect handler's JSON result report success?
function connectSucceeded(resultText: string): boolean {
  try {
    return (JSON.parse(resultText) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

// Build an McpServer with every hub tool bound to the given registry.
// A fresh registry per session keeps each client's Swiggy token, Bitrefill
// key and JAW client isolated while persisting them across that session's calls.
function buildServer(registry: Registry): McpServer {
  const server = new McpServer({ name: "zpay-hub", version: "1.0.0" });

  const ACCOUNT_DESC =
    "REQUIRED. Stable per-user account label (e.g. a username). Tokens are stored under this account, so two users on the same hub never share a login. Reuse the same label across reconnects to stay the same identity. There is no implicit default — you must name the account so a caller can never fall into a shared bucket by omission.";
  const FORCE_REAUTH_DESC =
    "Set true to re-authenticate: discards any cached token for this account and always runs a fresh browser login, returning a new login URL. Use when a user needs to log in as themselves or the stored token is wrong/expired. When false/omitted, a valid cached token for this account is reused silently.";

  server.tool(
    "connect_swiggy",
    "STEP 1 OF 3 — required before any purchase. Connect the Swiggy account so orders can be placed. Opens a browser login (phone number + OTP) if no cached token exists for this account. On success, Swiggy's upstream tools become available (swiggy__*) and the `buy` tool is unlocked. After this succeeds, proceed to connect_jaw (step 2).",
    {
      accountId: z.string().min(1).describe(ACCOUNT_DESC),
      forceReauth: z.boolean().optional().describe(FORCE_REAUTH_DESC),
    },
    async ({ accountId, forceReauth }) => {
      const text = await handleConnectSwiggy(registry, accountId, forceReauth);
      if (connectSucceeded(text)) await registerServiceTools(server, registry, "swiggy");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "connect_jaw",
    "STEP 2 OF 3 — required before any purchase. Connect the JAW crypto wallet that pays for Swiggy gift-card top-ups. Opens JAW's browser login and returns a login URL; complete it to authorize. On success, JAW wallet tools are available (jaw__*) including jaw_send_calls (token transfers) and jaw_session_x402_pay (web-service payments). After this succeeds, proceed to connect_bitrefill (step 3).",
    {
      accountId: z.string().min(1).describe(ACCOUNT_DESC),
      forceReauth: z.boolean().optional().describe(FORCE_REAUTH_DESC),
    },
    async ({ accountId, forceReauth }) => {
      const text = await handleConnectJaw(registry, accountId, forceReauth);
      if (connectSucceeded(text)) await registerServiceTools(server, registry, "jaw");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "connect_bitrefill",
    "STEP 3 OF 3 — required before any purchase. Connect Bitrefill, the gift-card fulfillment service that tops up Swiggy Money when the balance is insufficient. Get your API key from https://www.bitrefill.com/api/ (account → API), then pass it as apiKey — it is saved and can be omitted on later reconnects. NO purchase (buy tool) will proceed without this step: the hub blocks checkout-recovery entirely if Bitrefill is not connected. After this succeeds, all three services are ready and you may call buy.",
    {
      apiKey: z.string().optional(),
      accountId: z.string().min(1).describe(ACCOUNT_DESC),
    },
    async ({ apiKey, accountId }) => {
      const text = await handleConnectBitrefill(registry, apiKey, accountId);
      if (connectSucceeded(text)) await registerServiceTools(server, registry, "bitrefill");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "configure_permissions",
    {
      description:
        "Allow or deny individual upstream tools per service. Every passthrough tool (swiggy__*, jaw__*, bitrefill__*) is ALLOWED by default; use this to deny specific ones (or re-allow them). Permissions are keyed by the BARE upstream tool name, without the service__ prefix (e.g. \"jaw_send_calls\", not \"jaw__jaw_send_calls\").",
      inputSchema: {
        service: z.enum(SERVICES).describe("Which connected service the permissions apply to: swiggy | jaw | bitrefill."),
        permissions: z
          .record(z.string(), z.boolean())
          .describe("Map of bare upstream tool name -> true (allow) or false (deny). Only listed tools change; unlisted tools keep their current/default (allow) state."),
      },
    },
    async ({ service, permissions }) => {
      const result = await handleConfigurePermissions(registry, service, permissions as Record<string, boolean>);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "buy",
    "Place a Swiggy Instamart order. PREREQUISITES (all three required — call them in order if not done yet): 1) connect_swiggy, 2) connect_jaw, 3) connect_bitrefill. The hub will refuse to proceed without all three. Payment is ALWAYS Swiggy Money (SwiggyPay) — never Cash/COD, UPI, or card. If the Swiggy Money balance is short, the hub automatically tops it up via Bitrefill + JAW as a checkout-recovery step. Optionally supply deliveryName/Phone/Address to ship to any recipient; the Swiggy account remains the same, only the delivery destination changes.",
    {
      items: z
        .string()
        .describe("Free-text list of what to order, e.g. \"2L milk, a dozen eggs, 1kg onions\"."),
      maxSpendUsdc: z
        .number()
        .optional()
        .describe("Optional hard cap on total spend in USDC; the agent will not place an order that exceeds it."),
      deliveryName: z
        .string()
        .optional()
        .describe("Recipient's full name for this delivery (overrides account default)."),
      deliveryPhone: z
        .string()
        .optional()
        .describe("Recipient's phone number for delivery contact."),
      deliveryAddress: z
        .string()
        .optional()
        .describe("Delivery address text, e.g. '12 MG Road, Koramangala, Bangalore 560034'. When supplied, the agent resolves it via search_address instead of using the account's default saved address."),
    },
    async ({ items, maxSpendUsdc, deliveryName, deliveryPhone, deliveryAddress }) => {
      const delivery: DeliveryOverride | undefined =
        deliveryName || deliveryPhone || deliveryAddress
          ? { name: deliveryName, phone: deliveryPhone, address: deliveryAddress }
          : undefined;
      return { content: [{ type: "text", text: await handleBuy(registry, items, maxSpendUsdc, delivery) }] };
    }
  );

  // Register the full passthrough catalog up front so every jaw__*/swiggy__*/
  // bitrefill__* tool is visible in tools/list before any connect_*. Each stub
  // forwards to the live client once its service is connected.
  registerAllCatalogs(server, registry);

  return server;
}

// ── HTTP transport ───────────────────────────────────────────────────────────
// One StreamableHTTP transport + McpServer + Registry per MCP session, keyed by
// the Mcp-Session-Id header. A session is created on the initialize request.

const PORT = Number(process.env.ZPAY_HUB_PORT ?? 3400);
const MCP_PATH = "/mcp";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, Session>();

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function isInitialize(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { method?: string }).method === "initialize"
  );
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== MCP_PATH) {
    res.writeHead(404).end("Not Found");
    return;
  }

  const body = req.method === "POST" ? await readBody(req) : undefined;
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let session = sessionId ? sessions.get(sessionId) : undefined;

  // New session: only valid on an initialize POST.
  if (!session) {
    if (req.method !== "POST" || !isInitialize(body)) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid session. Send an initialize request first." },
          id: null,
        })
      );
      return;
    }

    const server = buildServer(new Registry());
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions.set(sid, { transport, server });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    session = { transport, server };
  }

  await session.transport.handleRequest(req, res, body);
});

httpServer.listen(PORT, () => {
  console.error(`zpay-hub listening on http://localhost:${PORT}${MCP_PATH}`);
});
