import { createHash } from "node:crypto";

/**
 * Minimal Circle Mint client (sandbox by default). Endpoints and bodies are from developers.circle.com
 * (circle-mint quickstarts: mint-and-redeem, transfer-on-chain). Measured behaviour on 2026-10-01:
 *  - sandbox `chain: "ARC"` settles on Arc Testnet (5042002) in both directions;
 *  - a transfer's on-chain tx can land BEFORE the API leaves `pending`, so never trust status alone;
 *  - a mock wire becomes an on-chain `USDC.mint` from a Circle minter key into a shared omnibus wallet.
 *
 * Every method returns the raw response body alongside the parsed value: the witness hashes the raw
 * bytes exactly as Circle served them.
 */

export type Money = { amount: string; currency: "USD" | "EUR" };

export type MintTransfer = {
  id: string;
  source: { type: string; id?: string; chain?: string };
  destination: { type: string; address?: string; chain?: string; id?: string };
  amount: Money;
  transactionHash?: string;
  status: "pending" | "running" | "complete" | "failed";
  createDate: string;
};

export type Raw<T> = { data: T; raw: string };

export class CircleMint {
  constructor(
    private apiKey: string,
    private base = "https://api-sandbox.circle.com",
  ) {
    if (!apiKey) throw new Error("CircleMint: missing API key");
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Raw<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Circle Mint ${method} ${path} → ${res.status}: ${raw.slice(0, 300)}`);
    return { data: (JSON.parse(raw) as { data: T }).data, raw };
  }

  balances() {
    return this.req<{ available: Money[]; unsettled: Money[] }>("GET", "/v1/businessAccount/balances");
  }

  getTransfer(id: string) {
    return this.req<MintTransfer>("GET", `/v1/businessAccount/transfers/${id}`);
  }

  listTransfers() {
    return this.req<MintTransfer[]>("GET", "/v1/businessAccount/transfers");
  }

  /** Send USDC on-chain to a recipient address already registered (and console-approved) in Mint. */
  createTransfer(idempotencyKey: string, addressId: string, amount: string) {
    return this.req<MintTransfer>("POST", "/v1/businessAccount/transfers", {
      idempotencyKey,
      destination: { type: "verified_blockchain", addressId },
      amount: { currency: "USD", amount },
    });
  }

  /** Sandbox only: simulate a wire in. Settles into the Mint balance (as newly issued USDC) within ~15 minutes. */
  mockWire(trackingRef: string, beneficiaryAccountNumber: string, amount: string) {
    return this.req<{ status: string }>("POST", "/v1/mocks/payments/wire", {
      amount: { amount, currency: "USD" },
      trackingRef,
      beneficiaryBank: { accountNumber: beneficiaryAccountNumber },
    });
  }

  /** Redeem: wire USD out of the Mint balance to a linked bank account. */
  createPayout(idempotencyKey: string, wireBankId: string, amount: string) {
    return this.req<{ id: string; status: string }>("POST", "/v1/businessAccount/payouts", {
      idempotencyKey,
      destination: { type: "wire", id: wireBankId },
      amount: { currency: "USD", amount },
    });
  }
}

/**
 * Circle requires UUID idempotency keys. Derive them deterministically from business data (UUIDv5-style,
 * SHA-1 based) so a retry of "fund obligation X" reuses the same key instead of creating a second transfer.
 */
export function idempotencyUuid(namespace: string, name: string): string {
  const h = createHash("sha1").update(`${namespace}:${name}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** "12.340000" or "12.34" (USD) → 12340000n (USDC 6dp). Rejects more than 6 decimals. */
export function usdToUnits(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new Error(`bad USD amount: ${amount}`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export function unitsToUsd(units: bigint): string {
  const s = units.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}
