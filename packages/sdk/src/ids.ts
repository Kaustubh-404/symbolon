import { keccak256, sha256, toBytes, type Hex } from "viem";

/**
 * Obligation ids are derived from the system of record, so the same ERP document always maps to the same
 * on-chain id. This is what makes registration and release idempotent across retries and re-syncs.
 * `obligationId("Purchase Invoice", "ACC-PINV-2026-00001")` === `cast keccak "Purchase Invoice:ACC-PINV-2026-00001"`.
 */
export function obligationId(doctype: string, name: string): Hex {
  return keccak256(toBytes(`${doctype}:${name}`));
}

/** Payee ids name the party in the system of record, e.g. ("Supplier", "ACME-001") or ("Employee", "HR-EMP-0001"). */
export function payeeId(kind: string, id: string): Hex {
  return keccak256(toBytes(`${kind}:${id}`));
}

/**
 * Canonical JSON: keys sorted recursively, no whitespace. Two parties hashing the same document must agree
 * byte for byte, whatever order their JSON serialiser emits keys in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** keccak256 of the canonical JSON. Used for document hashes and decision hashes. */
export function hashRecord(record: unknown): Hex {
  return keccak256(toBytes(canonicalJson(record)));
}

/** sha256 of raw evidence bytes (e.g. the exact Circle Mint API response body). Used for witness digests. */
export function digestEvidence(raw: string | Uint8Array): Hex {
  return sha256(typeof raw === "string" ? toBytes(raw) : raw);
}
