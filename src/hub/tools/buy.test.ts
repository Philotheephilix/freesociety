import { Registry } from "../registry.js";
import { handleBuy, buildSystemPrompt } from "./buy.js";

const r = new Registry();

// swiggy not connected
const res1 = await handleBuy(r, "milk");
const p1 = JSON.parse(res1);
console.assert(p1.ok === false && /swiggy/i.test(p1.error), "errors when swiggy not connected");

console.log("buy precondition tests passed");

// buildSystemPrompt tests
const promptWithDelivery = buildSystemPrompt({ name: "Ravi Kumar", phone: "9876543210", address: "12 MG Road, Bangalore" });
console.assert(promptWithDelivery.includes("search_address"), "delivery prompt must include search_address");
console.assert(promptWithDelivery.includes("12 MG Road, Bangalore"), "delivery prompt must include address");
console.assert(promptWithDelivery.includes("Ravi Kumar"), "delivery prompt must include name");
console.assert(!promptWithDelivery.includes("9876543210"), "delivery prompt must NOT include phone (PII)");

const promptDefault = buildSystemPrompt(undefined);
console.assert(promptDefault.includes("get_addresses"), "default prompt must include get_addresses");
console.assert(!promptDefault.includes("search_address"), "default prompt must NOT include search_address");

console.log("buildSystemPrompt tests passed");
