import { Registry } from "../registry.js";
import { getAccessToken, refreshSwiggyTokenSilent } from "../../auth.js";
import { getJawToken, refreshJawTokenSilent, JAW_MCP_URL } from "../../jaw-auth.js";
import { McpClient } from "../../mcp.js";
import { BitrefillClient, loadStoredApiKey, saveApiKey } from "../../bitrefill.js";

export async function handleConnectSwiggy(registry: Registry): Promise<string> {
  try {
    const token = await getAccessToken();
    const mcp = new McpClient("https://mcp.swiggy.com/im", token, {
      // Silent refresh only — never block an unattended call on browser OAuth.
      onAuthRefresh: refreshSwiggyTokenSilent,
    });
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
    // onAuthRefresh recovers from a mid-session 401 WITHOUT the interactive
    // flow: refreshJawTokenSilent uses the stored refresh_token only and throws
    // if it can't (so an unattended call fails fast instead of hanging on a
    // browser login that no one can complete).
    const mcp = new McpClient(JAW_MCP_URL, accessToken, {
      onAuthRefresh: refreshJawTokenSilent,
    });
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.jaw = mcp;
    return JSON.stringify({ ok: true, toolCount: tools.length, loginUrl: loginUrl || undefined });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

// Connect Bitrefill. The key is optional: if omitted, a previously stored key
// (~/.zpay/bitrefill.json or $BITREFILL_API_KEY) is reused so reconnects don't
// re-prompt. A supplied key is validated with a live call, then persisted.
export async function handleConnectBitrefill(registry: Registry, apiKey?: string): Promise<string> {
  try {
    const key = apiKey?.trim() || loadStoredApiKey();
    if (!key) {
      return JSON.stringify({
        ok: false,
        error: "No Bitrefill API key supplied and none stored. Pass apiKey once to save it.",
      });
    }
    // Validate the key with a lightweight authenticated call before storing it.
    const client = new BitrefillClient(key);
    await client.searchProducts("swiggy", "IN");
    registry.bitrefillKey = key;
    saveApiKey(key);
    return JSON.stringify({ ok: true, stored: true });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}
