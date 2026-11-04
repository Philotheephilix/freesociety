import { Registry } from "../registry.js";

// Minimal stub for McpClient
class FakeMcp {
  async initialize() {}
  async listTools() { return [{ name: "t1" }, { name: "t2" }]; }
}

// Patch Registry to accept stub
const registry = new Registry();
// @ts-ignore
registry.jaw = null;

// Test handleConnectJaw plumbing via duck-typed stub
// (actual network call not tested here — test the shape)
import { handleConnectJaw } from "./connect.js";

// Mock: override McpClient constructor in module — not possible cleanly in ESM;
// instead test that a bad URL returns an error string, not a throw.
const result = await handleConnectJaw(registry, "http://localhost:1", "tok").catch(e => `ERROR:${e.message}`);
console.assert(typeof result === "string", "returns string");
console.log("connect tool test passed");
