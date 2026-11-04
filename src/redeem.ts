// Redeem a Swiggy Money voucher on the Android emulator by driving the Swiggy
// app through adb (scripts/swiggy-redeem.sh). Also extracts the voucher
// code + PIN from a Bitrefill order's redemption_info, whose exact field names
// vary, so the parser is tolerant: it checks common field names first, then
// falls back to scanning the whole blob for a 16-char alphanumeric code and a
// 6-digit PIN.

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REDEEM_SCRIPT = join(__dirname, "..", "scripts", "swiggy-redeem.sh");

export interface VoucherCredentials {
  code: string; // 16-char alphanumeric
  pin: string; // 6 digits
}

// Field names Bitrefill / Razorpay vouchers have been seen to use for the
// card number and the PIN. First match wins; values are digit-stripped.
const CODE_KEYS = ["code", "cardnumber", "card_number", "voucher_code", "vouchercode", "redemptioncode", "redemption_code", "pin1", "number"];
const PIN_KEYS = ["pin", "pincode", "pin_code", "securitycode", "security_code", "cvv", "pin2"];

function digits(v: unknown): string {
  return typeof v === "string" || typeof v === "number"
    ? String(v).replace(/\D/g, "")
    : "";
}

// Strip to uppercase alphanumerics (Swiggy codes are 16-char alphanumeric,
// e.g. "ADVAK994WNW43380").
function alnum(v: unknown): string {
  return typeof v === "string" || typeof v === "number"
    ? String(v).toUpperCase().replace(/[^0-9A-Z]/g, "")
    : "";
}

// Pull {code, pin} out of an opaque redemption_info object. Returns null if a
// 16-char alphanumeric code and 6-digit PIN can't both be found.
export function parseVoucher(
  info: Record<string, unknown> | undefined | null
): VoucherCredentials | null {
  if (!info) return null;

  // Normalize keys to lowercase for lookup.
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(info)) lower[k.toLowerCase()] = v;

  let code = "";
  let pin = "";
  for (const k of CODE_KEYS) {
    const d = alnum(lower[k]);
    if (d.length === 16) { code = d; break; }
  }
  for (const k of PIN_KEYS) {
    const d = digits(lower[k]);
    if (d.length === 6) { pin = d; break; }
  }

  // Fallback: scan the serialized blob for the patterns. A 16-char alphanumeric
  // run is the code; a standalone 6-digit run (not part of the code) is the PIN.
  // This guesses structure from text, so log when we hit it — an unseen
  // redemption_info shape should surface here, not silently mis-parse.
  if (!code || !pin) {
    console.warn(
      `parseVoucher: known keys didn't yield a full voucher; falling back to blob scan. Keys seen: ${Object.keys(info).join(", ")}`
    );
    const blob = JSON.stringify(info);
    if (!code) code = (blob.match(/\b[0-9A-Z]{16}\b/i) ?? [""])[0].toUpperCase();
    if (!pin) {
      const sixes = blob.match(/\b\d{6}\b/g) ?? [];
      pin = sixes.find((s) => !code.includes(s)) ?? "";
    }
  }

  return code.length === 16 && pin.length === 6 ? { code, pin } : null;
}

// Run the emulator redeem script. Resolves on exit 0, rejects with the script's
// stderr otherwise. Streams the script's log lines to the console.
export function redeemOnEmulator(
  creds: VoucherCredentials
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bash", [REDEEM_SCRIPT, creds.code, creds.pin], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `redeem script exited ${code}`));
    });
  });
}
