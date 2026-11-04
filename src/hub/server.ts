import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Registry } from "./registry.js";
import { handleConnectSwiggy, handleConnectJaw, handleConnectBitrefill } from "./tools/connect.js";
import { handleConfigurePermissions } from "./tools/permissions.js";
import { handleBuy } from "./tools/buy.js";
import { registerServiceTools } from "./passthrough.js";

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

  server.tool("connect_swiggy", "Connect to Swiggy MCP service", async () => {
    const text = await handleConnectSwiggy(registry);
    if (connectSucceeded(text)) await registerServiceTools(server, registry, "swiggy");
    return { content: [{ type: "text", text }] };
  });

  server.tool(
    "connect_jaw",
    "Connect your JAW wallet. Opens JAW's login in your browser and returns the login URL; log in to authorize, no token needed.",
    async () => {
      const text = await handleConnectJaw(registry);
      if (connectSucceeded(text)) await registerServiceTools(server, registry, "jaw");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "connect_bitrefill",
    "Connect to Bitrefill with an API key",
    { apiKey: z.string() },
    async ({ apiKey }) => {
      const text = await handleConnectBitrefill(registry, apiKey);
      if (connectSucceeded(text)) await registerServiceTools(server, registry, "bitrefill");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "configure_permissions",
    {
      description: "Configure tool permissions for a service",
      inputSchema: {
        service: z.enum(SERVICES),
        permissions: z.record(z.string(), z.boolean()),
      },
    },
    async ({ service, permissions }) => {
      const result = await handleConfigurePermissions(registry, service, permissions as Record<string, boolean>);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "buy",
    "Order items from Swiggy Instamart using Claude agent",
    { items: z.string(), maxSpendUsdc: z.number().optional() },
    async ({ items, maxSpendUsdc }) => {
      return { content: [{ type: "text", text: await handleBuy(registry, items, maxSpendUsdc) }] };
    }
  );

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
