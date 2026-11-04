// JAW MCP OAuth. JAW is an OAuth2-protected MCP resource that does NOT support
// Dynamic Client Registration. Instead it supports Client ID Metadata Documents
// (CIMD): the client_id is itself a public https URL hosting a JSON document
// describing this client. JAW fetches that URL to validate the redirect_uri.
//
// Flow: build authorize URL with the CIMD client_id + PKCE -> JAW 303-redirects
// to its native login page -> user logs in with their JAW identity -> JAW
// redirects to our local callback with a code -> exchange for token -> store.

import { createServer } from "http";
import { createHash, randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// ── Config ─────────────────────────────────────────────────────────────────

export const JAW_MCP_URL = "https://mcp.jaw.id/mcp";
const JAW_ISSUER = "https://mcp.jaw.id";
const AUTH_ENDPOINT = `${JAW_ISSUER}/oauth/authorize`;
const TOKEN_ENDPOINT = `${JAW_ISSUER}/oauth/token`;
const REDIRECT_URI = "http://localhost:9989/callback";
const CALLBACK_PORT = 9989;
const SCOPE = "openid offline_access wallet:read wallet:permissions";

// Public CIMD document describing this client. JAW fetches this URL server-side;
// the document's own client_id field must equal this exact URL. Override with
// JAW_CLIENT_ID if the document is ever rehosted.
const CLIENT_ID =
  process.env.JAW_CLIENT_ID ??
  "https://gist.githubusercontent.com/Philotheephilix/ed07da39b9b68ae3f4f3a6e53cb272df/raw/zpay-jaw-client.json";

const TOKEN_PATH = join(homedir(), ".zpay", "jaw-auth.json");

// ── PKCE ─────────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ── Storage ────────────────────────────────────────────────────────────────

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

function loadStore(): StoredToken | null {
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

function saveStore(s: StoredToken): void {
  mkdirSync(join(homedir(), ".zpay"), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(s, null, 2), { mode: 0o600 });
}

// ── Local callback server ────────────────────────────────────────────────────

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code && state === expectedState) {
        res.end("<html><body><h2>JAW connected! You can close this tab.</h2></body></html>");
        server.close();
        resolve(code);
      } else {
        const why = error ?? (state !== expectedState ? "state mismatch" : "no code");
        res.end(`<html><body><h2>JAW auth failed: ${why}</h2></body></html>`);
        server.close();
        reject(new Error(`JAW OAuth error: ${why}`));
      }
    });
    server.listen(CALLBACK_PORT, "127.0.0.1");
    server.on("error", reject);
  });
}

function openBrowser(url: string): void {
  try {
    execSync(`open "${url}"`, { stdio: "ignore" });
  } catch {
    // Non-macOS or headless: caller surfaces the URL to the user instead.
  }
}

// ── Token exchange + refresh ─────────────────────────────────────────────────

async function exchangeCode(code: string, verifier: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`JAW token exchange failed ${res.status}: ${await res.text()}`);
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

async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`JAW token refresh failed ${res.status}: ${await res.text()}`);
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

// ── Public API ────────────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 60_000;

// The authorize URL the user opens to log in with their JAW identity. Returned
// alongside the token so the hub can surface it in the connect_jaw result.
export function buildAuthorizeUrl(challenge: string, state: string): string {
  const u = new URL(AUTH_ENDPOINT);
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return u.toString();
}

export interface JawAuthResult {
  accessToken: string;
  loginUrl: string; // the authorize URL that was opened for the user
}

// Non-interactive refresh (cache or refresh_token only, else throw) — wired to
// onAuthRefresh so an unattended 401 fails fast instead of hanging on a browser login.
export async function refreshJawTokenSilent(): Promise<string> {
  const store = loadStore();
  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return store.access_token;
  }
  if (store?.refresh_token) {
    const refreshed = await refreshAccessToken(store.refresh_token);
    saveStore(refreshed);
    return refreshed.access_token;
  }
  throw new Error(
    "JAW token expired and no refresh_token available — re-run connect_jaw to re-authorize."
  );
}

/**
 * Returns a valid JAW access token, running the browser OAuth flow if needed.
 * - Cached, unexpired token: returned immediately (loginUrl empty).
 * - Refreshable: refreshed silently (loginUrl empty).
 * - Otherwise: opens the browser to JAW's login, waits for the callback,
 *   exchanges the code, and stores the token. loginUrl is the opened URL.
 *
 * onAuthUrl, when provided, is called with the login URL right before opening
 * the browser, so the caller can surface it to the user immediately.
 */
export async function getJawToken(
  onAuthUrl?: (url: string) => void
): Promise<JawAuthResult> {
  const store = loadStore();

  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return { accessToken: store.access_token, loginUrl: "" };
  }

  if (store?.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(store.refresh_token);
      saveStore(refreshed);
      return { accessToken: refreshed.access_token, loginUrl: "" };
    } catch {
      // fall through to full flow
    }
  }

  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));
  const loginUrl = buildAuthorizeUrl(challenge, state);

  const callbackPromise = waitForCallback(state);
  if (onAuthUrl) onAuthUrl(loginUrl);
  openBrowser(loginUrl);

  const code = await callbackPromise;
  const token = await exchangeCode(code, verifier);
  saveStore(token);

  return { accessToken: token.access_token, loginUrl };
}
