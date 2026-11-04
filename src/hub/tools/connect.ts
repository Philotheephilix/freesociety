import { Registry } from "../registry.js";
import { getAccessToken, refreshSwiggyTokenSilent } from "../../auth.js";
import { getJawToken, refreshJawTokenSilent, JAW_MCP_URL } from "../../jaw-auth.js";
import { McpClient } from "../../mcp.js";
import { BitrefillClient, loadStoredApiKey, saveApiKey } from "../../bitrefill.js";
import { sanitizeAccountId } from "../../zpay-store.js";

export async function handleConnectSwiggy(
  registry: Registry,
  accountId?: string,
  forceReauth?: boolean
): Promise<string> {
  try {
    const account = sanitizeAccountId(accountId);
    registry.bindAccount(account);
    const token = await getAccessToken({ accountId: account, forceReauth });
    const mcp = new McpClient("https://mcp.swiggy.com/im", token, {
      // Silent refresh only — never block an unattended call on browser OAuth.
      // Bound to this session's account so it never reads another user's token.
      onAuthRefresh: () => refreshSwiggyTokenSilent(account),
    });
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.swiggy = mcp;
    return JSON.stringify({ ok: true, toolCount: tools.length, accountId: account });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

// Connect JAW with no manually-supplied token. Triggers JAW's native browser
// OAuth internally: auto-opens the login URL on the host AND returns it in the
// result so the user can open it themselves if the browser didn't launch.
// Blocks until the callback completes (or the flow times out). Pass forceReauth
// to discard any cached token and always run a fresh login.
export async function handleConnectJaw(
  registry: Registry,
  accountId?: string,
  forceReauth?: boolean
): Promise<string> {
  try {
    const account = sanitizeAccountId(accountId);
    registry.bindAccount(account);
    let loginUrl = "";
    const { accessToken } = await getJawToken(
      (url) => {
        loginUrl = url;
      },
      { accountId: account, forceReauth }
    );
    // onAuthRefresh recovers from a mid-session 401 WITHOUT the interactive
    // flow: refreshJawTokenSilent uses this account's stored refresh_token only
    // and throws if it can't (so an unattended call fails fast instead of
    // hanging on a browser login that no one can complete).
    const mcp = new McpClient(JAW_MCP_URL, accessToken, {
      onAuthRefresh: () => refreshJawTokenSilent(account),
    });
    await mcp.initialize();
    const tools = await mcp.listTools();
    registry.jaw = mcp;
    return JSON.stringify({
      ok: true,
      toolCount: tools.length,
      accountId: account,
      loginUrl: loginUrl || undefined,
    });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}

// Connect Bitrefill. The key is optional: if omitted, a previously stored key
// for this account (or $BITREFILL_API_KEY) is reused so reconnects don't
// re-prompt. A supplied key is validated with a live call, then persisted.
export async function handleConnectBitrefill(
  registry: Registry,
  apiKey?: string,
  accountId?: string
): Promise<string> {
  try {
    const account = sanitizeAccountId(accountId);
    registry.bindAccount(account);
    const key = apiKey?.trim() || loadStoredApiKey(account);
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
    saveApiKey(key, account);
    return JSON.stringify({ ok: true, stored: true, accountId: account });
  } catch (e) {
    return JSON.stringify({ ok: false, error: (e as Error).message });
  }
}
