import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Registry } from "./registry.js";
import { handleConnectSwiggy, handleConnectJaw } from "./tools/connect.js";
import { handleConfigurePermissions } from "./tools/permissions.js";
import { handleBuy } from "./tools/buy.js";

const registry = new Registry();

const server = new McpServer({
  name: "zpay-hub",
  version: "1.0.0",
});

// Register connect_swiggy tool
server.tool("connect_swiggy", "Connect to Swiggy MCP service", async () => {
  const result = await handleConnectSwiggy(registry);
  return {
    content: [{ type: "text", text: result }],
  };
});

// Register connect_jaw tool
server.tool(
  "connect_jaw",
  "Connect to JAW MCP service with URL and token",
  {
    url: z.string(),
    token: z.string(),
  },
  async ({ url, token }) => {
    const result = await handleConnectJaw(registry, url, token);
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Register configure_permissions tool
const SERVICES = ["swiggy", "jaw", "bitrefill"] as const;
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
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Register buy tool
server.tool(
  "buy",
  "Order items from Swiggy Instamart using Claude agent",
  {
    items: z.string(),
    maxSpendUsdc: z.number().optional(),
  },
  async ({ items, maxSpendUsdc }) => {
    const result = await handleBuy(registry, items, maxSpendUsdc);
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// Connect to stdio and start server
const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Failed to connect server:", error);
  process.exit(1);
});
