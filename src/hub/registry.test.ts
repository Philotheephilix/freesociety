import { Registry } from "./registry.js";

const r = new Registry();

// defaults
console.assert(r.swiggy === null, "swiggy starts null");
console.assert(r.jaw === null, "jaw starts null");
console.assert(r.isAllowed("swiggy", "checkout") === true, "default allow");

// set + check
r.setPermission("jaw", "pay_invoice", false);
console.assert(r.isAllowed("jaw", "pay_invoice") === false, "explicit deny");
console.assert(r.isAllowed("jaw", "other_tool") === true, "unset stays true");

console.log("registry tests passed");
