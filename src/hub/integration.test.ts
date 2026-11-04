/**
 * E2E integration test for the zpay-hub MCP server (stdio transport).
 *
 * Spawns the server as a child process, drives it via newline-delimited
 * JSON-RPC over stdin/stdout, and asserts expected behaviours without
 * requiring real credentials or a browser.
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as url from "url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, "server.ts");

/** A pending reply keyed by JSON-RPC id. */
type PendingReply = { resolve: (msg: JsonRpcMessage) => void; reject: (e: Error) => void };

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  params?: unknown;
}

class StdioMcpClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number | string, PendingReply>();
  private buf = "";

  constructor(proc: ChildProcess) {
    this.proc = proc;

    proc.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      // Consume complete newline-delimited JSON lines.
      const lines = this.buf.split("\n");
      this.buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(trimmed) as JsonRpcMessage;
        } catch {
          // Not JSON (e.g. debug output from tsx) — ignore.
          continue;
        }
        // Only dispatch messages that are replies (have numeric/string id and no method).
        if (msg.id !== undefined && msg.method === undefined) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
        }
        // Notifications (no id, has method) are intentionally dropped.
      }
    });
  }

  /** Send a JSON-RPC request and wait for the reply. */
  request(method: string, params?: unknown): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, 15_000);

      this.pending.set(id, {
        resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
        reject:  (e)   => { clearTimeout(timeout); reject(e); },
      });

      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.proc.stdin!.write(payload);
    });
  }

  /** Send a JSON-RPC notification (no id, no reply expected). */
  notify(method: string, params?: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.proc.stdin!.write(payload);
  }

  isAlive(): boolean {
    return this.proc.exitCode === null && !this.proc.killed;
  }

  kill(): void {
    this.proc.kill();
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let failures = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (!condition) {
    console.error(`  FAIL: ${label}${detail ? " — " + detail : ""}`);
    failures++;
  } else {
    console.log(`  ok:   ${label}`);
  }
}

async function runTests(): Promise<void> {
  console.log("Launching hub server …");

  const proc = spawn("npx", ["tsx", SERVER_PATH], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  });

  proc.on("error", (e) => {
    console.error("Failed to spawn server:", e.message);
    process.exit(1);
  });

  // Give the server a moment to start up its transport before we send anything.
  await new Promise((r) => setTimeout(r, 1500));

  const client = new StdioMcpClient(proc);

  try {
    // ------------------------------------------------------------------
    // 1. initialize handshake
    // ------------------------------------------------------------------
    console.log("\n[1] initialize");
    const initReply = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0.0" },
    });
    check("initialize succeeds (no error)", initReply.error === undefined,
      initReply.error ? JSON.stringify(initReply.error) : undefined);
    check("initialize result has serverInfo", !!(initReply.result as any)?.serverInfo);

    // Acknowledge (notifications/initialized — no reply expected).
    client.notify("notifications/initialized");

    // ------------------------------------------------------------------
    // 2. tools/list — must include all 4 hub tools
    // ------------------------------------------------------------------
    console.log("\n[2] tools/list");
    const listReply = await client.request("tools/list");
    check("tools/list succeeds", listReply.error === undefined);
    const tools: Array<{ name: string }> = (listReply.result as any)?.tools ?? [];
    const toolNames = tools.map((t) => t.name);
    const EXPECTED_TOOLS = ["connect_swiggy", "connect_jaw", "configure_permissions", "buy"];
    for (const name of EXPECTED_TOOLS) {
      check(`tool present: ${name}`, toolNames.includes(name),
        `got: [${toolNames.join(", ")}]`);
    }

    // ------------------------------------------------------------------
    // 3. connect_jaw with a bad URL — should fail gracefully (ok:false)
    // ------------------------------------------------------------------
    console.log("\n[3] connect_jaw (bad URL — expected to fail gracefully)");
    const jawReply = await client.request("tools/call", {
      name: "connect_jaw",
      arguments: { url: "http://localhost:1", token: "fake-token" },
    });
    check("connect_jaw call succeeded (no JSON-RPC error)", jawReply.error === undefined,
      jawReply.error ? JSON.stringify(jawReply.error) : undefined);

    // The tool returns a text block containing a JSON string.
    const jawContent: Array<{ type: string; text: string }> =
      (jawReply.result as any)?.content ?? [];
    const jawText = jawContent.find((b) => b.type === "text")?.text ?? "";
    let jawJson: { ok: boolean; error?: string } = { ok: true };
    try { jawJson = JSON.parse(jawText); } catch { /* keep default */ }
    check("connect_jaw returns JSON string", jawText.startsWith("{"),
      `text: ${jawText.slice(0, 120)}`);
    check("connect_jaw ok:false (bad URL)", jawJson.ok === false,
      `parsed: ${JSON.stringify(jawJson)}`);

    // ------------------------------------------------------------------
    // 4. configure_permissions — service:"jaw", pay_invoice:false
    // ------------------------------------------------------------------
    console.log("\n[4] configure_permissions");
    const permReply = await client.request("tools/call", {
      name: "configure_permissions",
      arguments: { service: "jaw", permissions: { pay_invoice: false } },
    });
    check("configure_permissions call succeeded", permReply.error === undefined,
      permReply.error ? JSON.stringify(permReply.error) : undefined);

    const permContent: Array<{ type: string; text: string }> =
      (permReply.result as any)?.content ?? [];
    const permText = permContent.find((b) => b.type === "text")?.text ?? "";
    let permJson: { ok: boolean; error?: string } = { ok: false };
    try { permJson = JSON.parse(permText); } catch { /* keep default */ }
    check("configure_permissions returns JSON string", permText.startsWith("{"),
      `text: ${permText.slice(0, 120)}`);
    check("configure_permissions ok:true", permJson.ok === true,
      `parsed: ${JSON.stringify(permJson)}`);

    // ------------------------------------------------------------------
    // 5. buy — Swiggy not connected → should fail with "Swiggy not connected"
    // ------------------------------------------------------------------
    console.log("\n[5] buy (Swiggy not connected)");
    const buyReply = await client.request("tools/call", {
      name: "buy",
      arguments: { items: "test item" },
    });
    check("buy call succeeded (no JSON-RPC error)", buyReply.error === undefined,
      buyReply.error ? JSON.stringify(buyReply.error) : undefined);

    const buyContent: Array<{ type: string; text: string }> =
      (buyReply.result as any)?.content ?? [];
    const buyText = buyContent.find((b) => b.type === "text")?.text ?? "";
    let buyJson: { ok: boolean; error?: string } = { ok: true };
    try { buyJson = JSON.parse(buyText); } catch { /* keep default */ }
    check("buy returns JSON string", buyText.startsWith("{"),
      `text: ${buyText.slice(0, 120)}`);
    check("buy ok:false (Swiggy not connected)", buyJson.ok === false,
      `parsed: ${JSON.stringify(buyJson)}`);
    check(
      'buy error mentions "Swiggy not connected"',
      (buyJson.error ?? "").toLowerCase().includes("swiggy not connected"),
      `error: ${buyJson.error}`,
    );

    // ------------------------------------------------------------------
    // 6. Server still alive
    // ------------------------------------------------------------------
    console.log("\n[6] server liveness");
    check("server still alive after all calls", client.isAlive());

  } finally {
    client.kill();
    // Wait briefly for the child to exit cleanly.
    await new Promise<void>((resolve) => {
      if (!proc.pid) { resolve(); return; }
      const t = setTimeout(resolve, 2000);
      proc.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log("\n" + "─".repeat(50));
  if (failures === 0) {
    console.log("E2E tests passed");
    process.exit(0);
  } else {
    console.error(`${failures} assertion(s) failed.`);
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
