// Bitrefill v2 API client. Buys gift cards, paid via crypto invoice.
// Docs: https://docs.bitrefill.com/

import { loadCredential, saveCredential, sanitizeAccountId } from "./zpay-store.js";

const BASE_URL = "https://api.bitrefill.com/v2";

// Load a stored key without throwing (env var wins, then the per-account store).
// Returns null when none is configured — callers that require a key use
// loadApiKey instead.
export function loadStoredApiKey(accountId?: string): string | null {
  const envKey = process.env.BITREFILL_API_KEY;
  if (envKey) return envKey;
  const cred = loadCredential(sanitizeAccountId(accountId), "bitrefill");
  return cred?.api_key || null;
}

// Persist the key for this account so future sessions/reconnects don't need it
// re-supplied.
export function saveApiKey(apiKey: string, accountId?: string): void {
  saveCredential(sanitizeAccountId(accountId), "bitrefill", { api_key: apiKey });
}

function loadApiKey(accountId?: string): string {
  const key = loadStoredApiKey(accountId);
  if (key) return key;
  throw new Error(
    `No Bitrefill API key. Set BITREFILL_API_KEY or connect_bitrefill with an apiKey.`
  );
}

export interface ProductPackage {
  id: string; // package_id, e.g. "swiggy-money-india<&>500"
  value: string; // face value in the product currency, e.g. "500"
  amount: number;
  price: number; // price in the product's listed currency units
}

export interface Product {
  id: string;
  name: string;
  country_code: string;
  currency: string;
  in_stock: boolean;
  redemption_methods?: string[];
  packages?: ProductPackage[];
  range?: { min: number; max: number; step: number };
}

export interface InvoicePayment {
  method: string; // e.g. "usdc_base"
  address: string; // on-chain deposit address
  currency: string; // e.g. "USDC"
  price: number; // micro-units for USDC (÷ 1e6 = USDC)
  status: string; // unpaid | payment_detected | payment_confirmed | ...
  commission: number;
}

export interface InvoiceOrder {
  id: string;
  status: string; // created | processing | delivered | failed | refunded
  delivered_time: string | null;
  product: { id: string; name: string; value: string; currency: string };
  redemption_info?: Record<string, unknown>;
}

export interface Invoice {
  id: string;
  status: string; // unpaid | payment_detected | payment_confirmed | pending | complete | ...
  payment: InvoicePayment;
  orders: InvoiceOrder[];
}

export interface CreateInvoiceItem {
  product_id: string;
  quantity: number;
  package_id?: string;
}

export class BitrefillClient {
  private key: string;

  constructor(apiKey?: string) {
    this.key = apiKey ?? loadApiKey();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Bitrefill ${method} ${path} failed ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  async searchProducts(query: string, country?: string): Promise<Product[]> {
    const params = new URLSearchParams({ q: query, limit: "20" });
    return this.request<Product[]>(
      "GET",
      `/products/search?${params.toString()}`
    ).then((products) =>
      country
        ? products.filter((p) => p.country_code === country)
        : products
    );
  }

  // Create a crypto invoice. For "usdc_base", payment.address is where USDC
  // (on Base) must be sent; payment.price is the amount in micro-USDC.
  async createInvoice(
    items: CreateInvoiceItem[],
    paymentMethod: string
  ): Promise<Invoice> {
    return this.request<Invoice>("POST", "/invoices", {
      products: items,
      payment_method: paymentMethod,
    });
  }

  async getInvoice(id: string): Promise<Invoice> {
    return this.request<Invoice>("GET", `/invoices/${id}`);
  }

  async getOrder(id: string): Promise<InvoiceOrder> {
    return this.request<InvoiceOrder>("GET", `/orders/${id}`);
  }
}
