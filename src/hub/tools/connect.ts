import { Registry } from "../registry.js";
import { getAccessToken } from "../../auth.js";
import { getJawToken, JAW_MCP_URL } from "../../jaw-auth.js";
import { McpClient } from "../../mcp.js";
import { BitrefillClient } from "../../bitrefill.js";

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

// Connect JAW with no manually-supplied args. Triggers JAW's native browser
// OAuth internally: auto-opens the login URL on the host AND returns it in the
// result so the user can open it themselves if the browser didn't launch.
// Blocks until the callback completes (or the flow times out).
export async function handleConnectJaw(registry: Registry): Promise<string> {
  try {
    let loginUrl = "";
    const { accessToken } = await getJawToken((url) => {
      loginUrl = url;
    });
    const mcp = new McpClient(JAW_MCP_URL, accessToken);
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.jaw = mcp;
    return JSON.stringify({ ok: true, toolCount: tools.length, loginUrl: loginUrl || undefined });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

export async function handleConnectBitrefill(registry: Registry, apiKey: string): Promise<string> {
  try {
    if (!apiKey || !apiKey.trim()) {
      return JSON.stringify({ ok: false, error: "apiKey is required" });
    }
    // Validate the key with a lightweight authenticated call before storing it.
    const client = new BitrefillClient(apiKey);
    await client.searchProducts("swiggy", "IN");
    registry.bitrefillKey = apiKey;
    return JSON.stringify({ ok: true });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}
