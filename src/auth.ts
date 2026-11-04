import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { execSync } from "child_process";
import {
  loadCredential,
  saveCredential,
  deleteCredential,
  sanitizeAccountId,
} from "./zpay-store.js";

// ── Storage ──────────────────────────────────────────────────────────────────

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

const CALLBACK_PORT = 9988;
const CALLBACK_TIMEOUT_MS = 3 * 60_000;

function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(204).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code) {
        res.end("<html><body><h2>Authenticated! You can close this tab.</h2></body></html>");
        finish(null, code);
      } else {
        res.end(`<html><body><h2>Auth failed: ${error ?? "unknown"}</h2></body></html>`);
        finish(new Error(`OAuth error: ${error ?? "unknown"}`));
      }
    });

    const timer = setTimeout(() => {
      finish(
        new Error(
          `Swiggy login was not completed within ${CALLBACK_TIMEOUT_MS / 60_000} minutes. ` +
            `The callback listener on port ${CALLBACK_PORT} has been closed; call connect_swiggy again to retry.`
        )
      );
    }, CALLBACK_TIMEOUT_MS);

    function finish(err: Error | null, code?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* already closing */
      }
      if (err) reject(err);
      else resolve(code!);
    }

    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        finish(
          new Error(
            `Cannot start the Swiggy login callback listener: port ${CALLBACK_PORT} is already in use — ` +
              `a previous login attempt is likely still open. Close that login tab, or free the port ` +
              `(lsof -ti :${CALLBACK_PORT} | xargs kill), then call connect_swiggy again.`
          )
        );
      } else {
        finish(e);
      }
    });

    server.listen(CALLBACK_PORT, "127.0.0.1");
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

function loadStore(accountId: string): AuthStore | null {
  const cred = loadCredential(accountId, "swiggy");
  if (!cred?.access_token) return null;
  return {
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    expires_at: cred.expires_at ?? 0,
    client_id: cred.client_id,
    token_endpoint: cred.token_endpoint,
  };
}

function saveStore(accountId: string, s: AuthStore): void {
  saveCredential(accountId, "swiggy", {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
    client_id: s.client_id,
    token_endpoint: s.token_endpoint,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 60_000; // refresh 1 min before expiry

// Non-interactive refresh (cache or refresh_token only, else throw) — wired to
// onAuthRefresh so an unattended 401 fails fast instead of hanging on a browser login.
export async function refreshSwiggyTokenSilent(accountId?: string): Promise<string> {
  const account = sanitizeAccountId(accountId);
  const store = loadStore(account);
  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return store.access_token;
  }
  if (store?.refresh_token && store.token_endpoint && store.client_id) {
    const refreshed = await refreshAccessToken(
      store.token_endpoint,
      store.client_id,
      store.refresh_token
    );
    saveStore(account, { ...refreshed, client_id: store.client_id, token_endpoint: store.token_endpoint });
    return refreshed.access_token;
  }
  throw new Error(
    "Swiggy token expired and no refresh_token available — re-run connect_swiggy to re-authorize."
  );
}

/**
 * Returns a valid Bearer token. Handles:
 * - First run: DCR → browser OAuth flow → store
 * - Subsequent runs: load from store, refresh if near-expiry, re-auth if refresh fails
 *
 * Credentials (incl. the per-account DCR client_id) are stored per account
 * (default "default"), so two users on the same hub never share a token.
 * forceReauth discards any cached/refreshable token for the account and always
 * runs the full browser OAuth flow.
 */
export async function getAccessToken(
  opts: { accountId?: string; forceReauth?: boolean } = {}
): Promise<string> {
  const account = sanitizeAccountId(opts.accountId);

  // On forceReauth, keep the DCR client registration (client_id/token_endpoint)
  // so we don't re-register, but drop the tokens so a fresh browser login runs.
  let store = loadStore(account);
  if (opts.forceReauth) {
    const dcr = store
      ? { client_id: store.client_id, token_endpoint: store.token_endpoint }
      : null;
    deleteCredential(account, "swiggy");
    if (dcr?.client_id) {
      saveCredential(account, "swiggy", {
        client_id: dcr.client_id,
        token_endpoint: dcr.token_endpoint,
      });
    }
    store = { access_token: "", expires_at: 0, ...dcr } as AuthStore;
    // access_token empty + expires_at 0 → falls through to the full OAuth flow,
    // while client_id is still available below to skip re-registration.
    if (!dcr?.client_id) store = null;
  }

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
      saveStore(account, { ...refreshed, client_id: store.client_id, token_endpoint: store.token_endpoint });
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

  saveStore(account, { ...token, client_id: clientId, token_endpoint: meta.token_endpoint });
  console.log("Swiggy token stored.\n");

  return token.access_token;
}
