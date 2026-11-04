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
import { execSync } from "child_process";
import {
  loadCredential,
  saveCredential,
  deleteCredential,
  sanitizeAccountId,
} from "./zpay-store.js";

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

// ── PKCE ─────────────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ── Storage (SQLite, keyed by account) ───────────────────────────────────────

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

function loadStore(accountId: string): StoredToken | null {
  const cred = loadCredential(accountId, "jaw");
  if (!cred?.access_token) return null;
  return {
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    expires_at: cred.expires_at ?? 0,
  };
}

function saveStore(accountId: string, s: StoredToken): void {
  saveCredential(accountId, "jaw", {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
  });
}

// ── Local callback server ────────────────────────────────────────────────────

// How long to keep the local callback listener open waiting for the user to
// finish the JAW login. If they never do, we close it so the port is freed and
// the next connect_jaw can bind cleanly (instead of EADDRINUSE forever).
const CALLBACK_TIMEOUT_MS = 3 * 60_000;

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${CALLBACK_PORT}`);
      // Ignore stray requests (e.g. favicon) so they don't resolve/reject the flow.
      if (url.pathname !== "/callback") {
        res.writeHead(204).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (code && state === expectedState) {
        res.end("<html><body><h2>JAW connected! You can close this tab.</h2></body></html>");
        finish(null, code);
      } else {
        const why = error ?? (state !== expectedState ? "state mismatch" : "no code");
        res.end(`<html><body><h2>JAW auth failed: ${why}</h2></body></html>`);
        finish(new Error(`JAW OAuth error: ${why}`));
      }
    });

    // Single cleanup path: close the listener (freeing the port) exactly once,
    // then settle the promise.
    const timer = setTimeout(() => {
      finish(
        new Error(
          `JAW login was not completed within ${CALLBACK_TIMEOUT_MS / 60_000} minutes. ` +
            `The callback listener on port ${CALLBACK_PORT} has been closed; call connect_jaw again to retry.`
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
            `Cannot start the JAW login callback listener: port ${CALLBACK_PORT} is already in use — ` +
              `a previous login attempt is likely still open. Close that login tab, or free the port ` +
              `(lsof -ti :${CALLBACK_PORT} | xargs kill), then call connect_jaw again.`
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
export async function refreshJawTokenSilent(accountId?: string): Promise<string> {
  const account = sanitizeAccountId(accountId);
  const store = loadStore(account);
  if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
    return store.access_token;
  }
  if (store?.refresh_token) {
    const refreshed = await refreshAccessToken(store.refresh_token);
    saveStore(account, refreshed);
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
 * Credentials are stored per account (default "default"), so two users on the
 * same hub never share a token. forceReauth discards any cached/refreshable
 * token for the account and always runs the full browser flow — this is how a
 * user re-authenticates as themselves and always gets a fresh login URL back.
 *
 * onAuthUrl, when provided, is called with the login URL right before opening
 * the browser, so the caller can surface it to the user immediately.
 */
export async function getJawToken(
  onAuthUrl?: (url: string) => void,
  opts: { accountId?: string; forceReauth?: boolean } = {}
): Promise<JawAuthResult> {
  const account = sanitizeAccountId(opts.accountId);

  if (opts.forceReauth) {
    deleteCredential(account, "jaw");
  } else {
    const store = loadStore(account);

    if (store?.access_token && store.expires_at > Date.now() + REFRESH_BUFFER_MS) {
      return { accessToken: store.access_token, loginUrl: "" };
    }

    if (store?.refresh_token) {
      try {
        const refreshed = await refreshAccessToken(store.refresh_token);
        saveStore(account, refreshed);
        return { accessToken: refreshed.access_token, loginUrl: "" };
      } catch {
        // fall through to full flow
      }
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
  saveStore(account, token);

  return { accessToken: token.access_token, loginUrl };
}
