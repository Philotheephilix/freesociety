import { Registry } from "../registry.js";
import { handleConfigurePermissions } from "./permissions.js";

const r = new Registry();
const res = handleConfigurePermissions(r, "jaw", { pay_invoice: false });
const parsed = JSON.parse(res);
console.assert(parsed.ok === true, "returns ok");
console.assert(r.isAllowed("jaw", "pay_invoice") === false, "permission set");
console.assert(r.isAllowed("jaw", "other") === true, "unset unchanged");

// invalid service
const res2 = handleConfigurePermissions(r, "unknown_service", { foo: true });
const parsed2 = JSON.parse(res2);
console.assert(parsed2.ok === false, "invalid service returns error");

console.log("permissions tool test passed");
