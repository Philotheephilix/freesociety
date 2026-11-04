import { Registry } from "../registry.js";
import { getAccessToken } from "../../auth.js";
import { McpClient } from "../../mcp.js";

export async function handleConnectSwiggy(registry: Registry): Promise<string> {
  try {
    const token = await getAccessToken();
    const mcp = new McpClient("https://mcp.swiggy.com/im", token);
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.swiggy = mcp;
    return JSON.stringify({ ok: true, toolCount: tools.length });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

export async function handleConnectJaw(registry: Registry, url: string, token: string): Promise<string> {
  try {
    const mcp = new McpClient(url, token);
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.jaw = mcp;
    return JSON.stringify({ ok: true, toolCount: tools.length });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}
