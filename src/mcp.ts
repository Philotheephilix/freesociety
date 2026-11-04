// Minimal MCP client over Streamable HTTP (JSON-RPC).
// Handles both plain-JSON and SSE (text/event-stream) responses.

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export class McpClient {
  private url: string;
  private token: string;
  private sessionId: string | null = null;
  private nextId = 1;
  // Called when a request gets HTTP 401 (token expired/revoked). Should return
  // a fresh bearer token; the request is then retried once with it. Optional —
  // services with non-expiring tokens (e.g. Bitrefill REST) don't set it.
  private onAuthRefresh?: () => Promise<string>;
  private readonly timeoutMs: number;
  private readonly maxNetworkRetries: number;

  constructor(
    url: string,
    token: string,
    opts: {
      onAuthRefresh?: () => Promise<string>;
      timeoutMs?: number;
      maxNetworkRetries?: number;
    } = {}
  ) {
    this.url = url;
    this.token = token;
    this.onAuthRefresh = opts.onAuthRefresh;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxNetworkRetries = opts.maxNetworkRetries ?? 2;
  }

  // Low-level POST with an AbortController timeout. Throws on network failure or
  // timeout (a TypeError "fetch failed" or an AbortError), which the retry loop
  // in `rpc` catches. Does NOT inspect HTTP status — the caller does.
  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private isNetworkError(e: unknown): boolean {
    const msg = (e as Error)?.message ?? "";
    const name = (e as Error)?.name ?? "";
    return (
      name === "AbortError" ||
      /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|terminated/i.test(msg)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async rpc(
    method: string,
    params?: unknown,
    opts: { retryNetwork?: boolean } = {}
  ): Promise<any> {
    // Network-level retries are only safe for idempotent calls. A tools/call may
    // be non-idempotent (e.g. a JAW token transfer): if the request reaches the
    // server and the *response* is lost, retrying would execute it twice. So
    // callers opt in explicitly; default is no network retry.
    const retryNetwork = opts.retryNetwork ?? false;
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    let refreshed = false;

    for (let attempt = 0; ; ) {
      let res: Response;
      try {
        res = await this.post(payload);
      } catch (e) {
        // Network failure/timeout. Retry only when the caller marked this call
        // idempotent; otherwise surface it (never silently re-send money).
        if (retryNetwork && this.isNetworkError(e) && attempt < this.maxNetworkRetries) {
          attempt++;
          await this.delay(250 * attempt);
          continue;
        }
        throw new Error(`MCP ${method} transport error: ${(e as Error).message}`);
      }

      const sid = res.headers.get("Mcp-Session-Id");
      if (sid) this.sessionId = sid;

      // Token expired/revoked: the server REJECTED the request (it did not
      // execute), so refreshing the token and retrying once is always safe,
      // even for non-idempotent calls. Drain the body first so undici can reuse
      // the socket, and don't charge this against the network-retry budget.
      if (res.status === 401 && this.onAuthRefresh && !refreshed) {
        refreshed = true;
        await res.text().catch(() => {});
        this.token = await this.onAuthRefresh();
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`MCP ${method} failed ${res.status}: ${text}`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      const parsed: JsonRpcResponse = contentType.includes("text/event-stream")
        ? await this.readSse(res, id)
        : ((await res.json()) as JsonRpcResponse);

      if (parsed.error) {
        throw new Error(`MCP ${method} error: ${parsed.error.message}`);
      }
      return parsed.result;
    }
  }

  // Read an SSE body and return the JSON-RPC message matching `id`.
  private async readSse(res: Response, id: number | string): Promise<JsonRpcResponse> {
    const text = await res.text();
    for (const block of text.split("\n\n")) {
      const dataLines = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      try {
        const msg = JSON.parse(dataLines.join("")) as JsonRpcResponse;
        if (msg.id === id) return msg;
      } catch {
        // skip non-JSON SSE events (ping, etc.)
      }
    }
    throw new Error("No matching JSON-RPC response in SSE stream");
  }

  // Fire-and-forget JSON-RPC notification (no response expected). Transient
  // transport failures are tolerated; a non-network error (e.g. a thrown
  // serialization/programming fault) is surfaced so a broken handshake is not
  // hidden. Callers that must not throw can pass tolerant: true.
  private async notify(
    method: string,
    params?: unknown,
    opts: { tolerant?: boolean } = {}
  ): Promise<void> {
    try {
      await this.post({ jsonrpc: "2.0", method, params });
    } catch (e) {
      if (opts.tolerant || this.isNetworkError(e)) return;
      throw new Error(`MCP notify ${method} failed: ${(e as Error).message}`);
    }
  }

  async initialize(): Promise<void> {
    // Idempotent handshake → safe to retry on transient network failure.
    await this.rpc(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "zpay", version: "1.0.0" },
      },
      { retryNetwork: true }
    );
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpTool[]> {
    // Read-only enumeration → safe to retry.
    const result = await this.rpc("tools/list", undefined, { retryNetwork: true });
    return (result?.tools ?? []) as McpTool[];
  }

  // Generic tool call. retryNetwork defaults to FALSE: a tool may be
  // non-idempotent (e.g. jaw_send_calls moves money), and a lost response after
  // the server already executed would double-spend on retry. Only callers that
  // KNOW a given tool is a read (get_assets, get_calls_status, product search…)
  // should pass retryNetwork: true.
  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts: { retryNetwork?: boolean } = {}
  ): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args }, opts);
    // MCP tool results: { content: [{type:"text", text:"..."}], isError?: bool }
    const blocks = result?.content ?? [];
    const text = blocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    if (result?.isError) {
      return `ERROR: ${text || JSON.stringify(result)}`;
    }
    return text || JSON.stringify(result);
  }
}
