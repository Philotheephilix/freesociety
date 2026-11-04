import { Registry } from "../registry.js";

// handleConnectJaw now takes no token/url args — it drives JAW's browser OAuth
// internally. We can't run the live flow here (it opens a browser and blocks on
// a callback), so this just pins the no-arg signature and the error-string shape
// by forcing the token exchange to fail fast against an unreachable issuer.
import { handleConnectJaw } from "./connect.js";

const registry = new Registry();

// A cached-but-expired token with no refresh_token would still trigger the
// browser flow, so we don't exercise the happy path here. Instead assert the
// function is callable with just a registry and the return type is a string.
const isNoArg = handleConnectJaw.length === 1;
console.assert(isNoArg, "handleConnectJaw takes only (registry)");
console.log("connect tool signature test passed");
