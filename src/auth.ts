import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// ── Storage ──────────────────────────────────────────────────────────────────

const TOKEN_PATH = join(homedir(), ".zpay", "auth.json");

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(
    createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

// ── Dynamic Client Registration ───────────────────────────────────────────────
// Swiggy MCP uses DCR — no static client_id to configure.

const SWIGGY_ISSUER = "https://mcp.swiggy.com";
const REDIRECT_URI = "http://localhost:9988/callback";

interface DCRResponse {
  client_id: string;
  client_secret?: string;
}

interface OAuthMeta {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

async function fetchOAuthMeta(): Promise<OAuthMeta> {
  const res = await fetch(
    `${SWIGGY_ISSUER}/.well-known/oauth-authorization-server`
  );
  if (!res.ok) {
    // Fallback to standard paths if discovery isn't available
    return {
      authorization_endpoint: `${SWIGGY_ISSUER}/oauth/authorize`,
      token_endpoint: `${SWIGGY_ISSUER}/oauth/token`,
      registration_endpoint: `${SWIGGY_ISSUER}/oauth/register`,
    };
  }
  return res.json() as Promise<OAuthMeta>;
}

async function registerClient(registrationEndpoint: string): Promise<DCRResponse> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "zpay-instamart-agent",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DCR failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<DCRResponse>;
}

// ── Local callback server ─────────────────────────────────────────────────────

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:9988`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code) {
        res.end(
          "<html><body><h2>Authenticated! You can close this tab.</h2></body></html>"
        );
        server.close();
        resolve(code);
      } else {
        res.end(
          `<html><body><h2>Auth failed: ${error ?? "unknown"}</h2></body></html>`
        );
        server.close();
        reject(new Error(`OAuth error: ${error}`));
      }
    });
    server.listen(9988, "127.0.0.1");
    server.on("error", reject);
  });
}

function openBrowser(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
    console.log(`\nOpen this URL in your browser:\n${url}\n`);
  }
}

// ── Token exchange + refresh ──────────────────────────────────────────────────

async function exchangeCode(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  verifier: string
): Promise<StoredToken> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

async function refreshAccessToken(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string
): Promise<StoredToken> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

// ── Client ID storage ─────────────────────────────────────────────────────────
// We store client_id alongside the token so DCR only happens once.

interface AuthStore extends StoredToken {
  client_id?: string;
  token_endpoint?: string;
}

function loadStore(): AuthStore | null {
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as AuthStore;
  } catch {
    return null;
  }
}

function saveStore(s: AuthStore): void {
  mkdirSync(join(homedir(), ".zpay"), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
}

// ── Public API ────────────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 60_000; // refresh 1 min before expiry

// Non-interactive refresh (cache or refresh_token only, else throw) — wired to
// onAuthRefresh so an unattended 401 fails fast instead of hanging on a browser login.
export async function refreshSwiggyTokenSilent(): Promise<string> {
  const store = loadStore();
  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return store.access_token;
  }
  if (store?.refresh_token && store.token_endpoint && store.client_id) {
    const refreshed = await refreshAccessToken(
      store.token_endpoint,
      store.client_id,
      store.refresh_token
    );
    saveStore({ ...refreshed, client_id: store.client_id, token_endpoint: store.token_endpoint });
    return refreshed.access_token;
  }
  throw new Error(
    "Swiggy token expired and no refresh_token available — re-run connect_swiggy to re-authorize."
  );
}

/**
 * Returns a valid Bearer token. Handles:
 * - First run: DCR → browser OAuth flow → store
 * - Subsequent runs: load from disk, refresh if near-expiry, re-auth if refresh fails
 */
export async function getAccessToken(): Promise<string> {
  const store = loadStore();

  // Happy path: token exists and not near expiry
  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return store.access_token;
  }

  // Try refresh
  if (store?.refresh_token && store.token_endpoint && store.client_id) {
    try {
      console.log("Refreshing Swiggy token...");
      const refreshed = await refreshAccessToken(
        store.token_endpoint,
        store.client_id,
        store.refresh_token
      );
      saveStore({ ...refreshed, client_id: store.client_id, token_endpoint: store.token_endpoint });
      return refreshed.access_token;
    } catch (e) {
      console.warn("Token refresh failed, re-authenticating...", (e as Error).message);
    }
  }

  // Full OAuth flow
  console.log("\nSwiggy auth required — starting OAuth flow...");
  const meta = await fetchOAuthMeta();

  // DCR: reuse stored client_id if available
  let clientId = store?.client_id;
  if (!clientId) {
    if (!meta.registration_endpoint) {
      throw new Error(
        "No registration_endpoint in OAuth metadata. " +
          "Set SWIGGY_CLIENT_ID env var or check Swiggy developer docs."
      );
    }
    console.log("Registering OAuth client...");
    const dcr = await registerClient(meta.registration_endpoint);
    clientId = dcr.client_id;
    console.log(`Client registered: ${clientId}`);
  }

  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "mcp:tools mcp:resources mcp:prompts");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  console.log("Opening browser for Swiggy login (phone + OTP)...");
  const callbackPromise = waitForCallback();
  openBrowser(authUrl.toString());

  const code = await callbackPromise;
  console.log("Auth code received. Exchanging for token...");

  const token = await exchangeCode(
    meta.token_endpoint,
    clientId,
    code,
    verifier
  );

  saveStore({ ...token, client_id: clientId, token_endpoint: meta.token_endpoint });
  console.log(`Token stored at ${TOKEN_PATH}\n`);

  return token.access_token;
}
