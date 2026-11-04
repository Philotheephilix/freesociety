// Per-account credential store for the zpay hub. One SQLite DB at
// ~/.zpay/zpay.db holds every account's OAuth tokens / API keys, keyed by
// (account_id, service). This replaces the three machine-global JSON files
// (~/.zpay/{jaw-auth,auth,bitrefill}.json) that were shared across every MCP
// session — which let whoever logged in last own the token and silently
// connected the next user to the previous user's wallet.
//
// node:sqlite is a Node built-in (Node >=22.5 / stable in 24+), so there is no
// extra dependency. Each service reads/writes only its own columns; unused
// columns stay NULL.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type Service = "swiggy" | "jaw" | "bitrefill";

export interface Credential {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  client_id?: string; // Swiggy DCR
  token_endpoint?: string; // Swiggy DCR
  api_key?: string; // Bitrefill
}

const ZPAY_DIR = join(homedir(), ".zpay");
const DB_PATH = join(ZPAY_DIR, "zpay.db");

// Legacy single-file locations, imported once into the `default` account.
const LEGACY_FILES: Record<Service, string> = {
  jaw: join(ZPAY_DIR, "jaw-auth.json"),
  swiggy: join(ZPAY_DIR, "auth.json"),
  bitrefill: join(ZPAY_DIR, "bitrefill.json"),
};

const DEFAULT_ACCOUNT = "default";

// ── Account id ────────────────────────────────────────────────────────────────

// Normalise a user-supplied account label to a safe, predictable key. Lowercase
// and strip anything outside [a-z0-9_-]. Empty input → "default"; input that is
// non-empty but empties out after stripping is a user error (throws).
export function sanitizeAccountId(raw?: string | null): string {
  if (raw == null || raw.trim() === "") return DEFAULT_ACCOUNT;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (cleaned === "") {
    throw new Error(
      `Invalid accountId ${JSON.stringify(raw)} — must contain at least one of [a-z0-9_-].`
    );
  }
  return cleaned;
}

// ── DB singleton ────────────────────────────────────────────────────────────

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(ZPAY_DIR, { recursive: true, mode: 0o700 });
  db = new DatabaseSync(DB_PATH);
  // Tokens are secrets — keep the DB file owner-only (mode on create isn't
  // guaranteed, so chmod explicitly; ignore if the file isn't ours yet).
  try {
    chmodSync(DB_PATH, 0o600);
  } catch {
    /* best effort */
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      account_id     TEXT NOT NULL,
      service        TEXT NOT NULL,
      access_token   TEXT,
      refresh_token  TEXT,
      expires_at     INTEGER,
      client_id      TEXT,
      token_endpoint TEXT,
      api_key        TEXT,
      updated_at     INTEGER NOT NULL,
      PRIMARY KEY (account_id, service)
    );
  `);
  return db;
}

function rowToCredential(row: Record<string, unknown> | undefined): Credential | null {
  if (!row) return null;
  const c: Credential = {};
  if (row.access_token != null) c.access_token = String(row.access_token);
  if (row.refresh_token != null) c.refresh_token = String(row.refresh_token);
  if (row.expires_at != null) c.expires_at = Number(row.expires_at);
  if (row.client_id != null) c.client_id = String(row.client_id);
  if (row.token_endpoint != null) c.token_endpoint = String(row.token_endpoint);
  if (row.api_key != null) c.api_key = String(row.api_key);
  return c;
}

// ── Legacy migration (default account only, once per service) ───────────────

// If the default account has no row for this service but a legacy JSON file
// exists, import it so the already-authenticated machine user isn't logged out.
// Returns the imported credential (now also persisted), or null if nothing to do.
function migrateLegacy(service: Service): Credential | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(LEGACY_FILES[service], "utf8")) as Record<string, unknown>;
  } catch {
    return null; // no legacy file / unreadable
  }

  const cred: Credential = {};
  if (service === "bitrefill") {
    if (typeof parsed.api_key === "string" && parsed.api_key) cred.api_key = parsed.api_key;
    else return null;
  } else {
    if (typeof parsed.access_token !== "string" || !parsed.access_token) return null;
    cred.access_token = parsed.access_token;
    if (typeof parsed.refresh_token === "string") cred.refresh_token = parsed.refresh_token;
    if (typeof parsed.expires_at === "number") cred.expires_at = parsed.expires_at;
    if (typeof parsed.client_id === "string") cred.client_id = parsed.client_id;
    if (typeof parsed.token_endpoint === "string") cred.token_endpoint = parsed.token_endpoint;
  }

  saveCredential(DEFAULT_ACCOUNT, service, cred);
  return cred;
}

// ── Public CRUD ──────────────────────────────────────────────────────────────

export function loadCredential(accountId: string, service: Service): Credential | null {
  const row = getDb()
    .prepare("SELECT * FROM credentials WHERE account_id = ? AND service = ?")
    .get(accountId, service) as Record<string, unknown> | undefined;

  const cred = rowToCredential(row);
  if (cred) return cred;

  // One-time import of the pre-existing single-file token for the default user.
  if (accountId === DEFAULT_ACCOUNT) return migrateLegacy(service);
  return null;
}

export function saveCredential(accountId: string, service: Service, cred: Credential): void {
  getDb()
    .prepare(
      `INSERT INTO credentials
         (account_id, service, access_token, refresh_token, expires_at, client_id, token_endpoint, api_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, service) DO UPDATE SET
         access_token   = excluded.access_token,
         refresh_token  = excluded.refresh_token,
         expires_at     = excluded.expires_at,
         client_id      = excluded.client_id,
         token_endpoint = excluded.token_endpoint,
         api_key        = excluded.api_key,
         updated_at     = excluded.updated_at`
    )
    .run(
      accountId,
      service,
      cred.access_token ?? null,
      cred.refresh_token ?? null,
      cred.expires_at ?? null,
      cred.client_id ?? null,
      cred.token_endpoint ?? null,
      cred.api_key ?? null,
      Date.now()
    );
}

export function deleteCredential(accountId: string, service: Service): void {
  getDb()
    .prepare("DELETE FROM credentials WHERE account_id = ? AND service = ?")
    .run(accountId, service);
}
