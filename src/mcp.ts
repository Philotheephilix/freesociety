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

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MCP ${method} failed ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    let parsed: JsonRpcResponse;

    if (contentType.includes("text/event-stream")) {
      parsed = await this.readSse(res, id);
    } else {
      parsed = (await res.json()) as JsonRpcResponse;
    }

    if (parsed.error) {
      throw new Error(`MCP ${method} error: ${parsed.error.message}`);
    }
    return parsed.result;
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

  private async notify(method: string, params?: unknown): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zpay", version: "1.0.0" },
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc("tools/list");
    return (result?.tools ?? []) as McpTool[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args });
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
