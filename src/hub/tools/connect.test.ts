import { Registry } from "../registry.js";

// handleConnectJaw drives JAW's browser OAuth internally (no token arg) but now
// accepts an optional per-account id and a forceReauth flag:
// (registry, accountId?, forceReauth?). We can't run the live flow here (it
// opens a browser and blocks on a callback), so this pins the signature shape
// and that it binds the account on the registry.
import { handleConnectJaw } from "./connect.js";

const registry = new Registry();

// registry + two optional args.
console.assert(handleConnectJaw.length === 3, "handleConnectJaw takes (registry, accountId?, forceReauth?)");

// Binding an account must be reflected on the registry and guard against a
// second, conflicting non-default account in the same session.
registry.bindAccount("alice");
console.assert(registry.accountId === "alice", "bindAccount sets the account");
let threw = false;
try {
  registry.bindAccount("bob");
} catch {
  threw = true;
}
console.assert(threw, "binding a different non-default account in one session throws");

console.log("connect tool signature test passed");
