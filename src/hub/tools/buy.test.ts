import { Registry } from "../registry.js";
import { handleBuy } from "./buy.js";

const r = new Registry();

// swiggy not connected
const res1 = await handleBuy(r, "milk");
const p1 = JSON.parse(res1);
console.assert(p1.ok === false && /swiggy/i.test(p1.error), "errors when swiggy not connected");

console.log("buy precondition tests passed");
