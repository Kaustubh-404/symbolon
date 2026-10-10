import { BaseError, encodeErrorResult, toFunctionSelector, type AbiFunction, type Hex } from "viem";
import { client } from "./client";
import { decodeRefusal, symbolonAbi } from "@symbolon/sdk";
import { EXPLORER_API, SNAPSHOT_TTL_MS, SYMBOLON } from "./config";
import { memo } from "./memo";

/**
 * Every REVERTED transaction sent to the Symbolon contract, from the Blockscout v2 API.
 * eth_getLogs cannot see these (a reverted tx emits nothing), so the explorer is the index.
 */

export type MinedRefusal = {
  hash: Hex;
  blockNumber: bigint;
  timestamp: string | null;
  method: string | null;
  from: string | null;
  obligationId: Hex | null;
  /** custom error name, or a description when no revert data was returned */
  name: string;
  human: string;
  args: readonly unknown[];
  /** where the decoding came from */
  decodedFrom: "revert data" | "explorer decoding" | "replay" | "none";
};

/**
 * `refusals`: reverted calls to Symbolon's own functions (the contract saying no).
 * `otherReverted`: reverted transactions to the contract address that are not calls to its functions, e.g. Circle
 * Mint trying to send native USDC to a contract with no payable receive(). Counted, never presented as refusals.
 */
export type RefusalIndex = { refusals: MinedRefusal[]; otherReverted: number; scannedTxs: number; truncated: boolean };

const SELECTORS = new Set(
  (symbolonAbi as readonly { type: string }[]).filter((x) => x.type === "function").map((f) => toFunctionSelector(f as AbiFunction).toLowerCase()),
);

type BsParam = { name?: string; type?: string; value?: unknown };
type BsTx = {
  hash: Hex;
  block_number?: number | null;
  block?: number | null;
  timestamp?: string | null;
  method?: string | null;
  status?: string | null;
  result?: string | null;
  from?: { hash?: string } | null;
  raw_input?: string | null;
  revert_reason?: unknown;
  decoded_input?: { parameters?: BsParam[] } | null;
};
type BsPage = { items?: BsTx[]; next_page_params?: Record<string, string | number | null> | null };

const MAX_PAGES = 40; // 50 txs per page
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(params: Record<string, string | number | null> | null): Promise<BsPage> {
  const url = new URL(`${EXPLORER_API}/addresses/${SYMBOLON}/transactions`);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()) as BsPage;
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`Blockscout ${res.status} for ${url}`);
    await sleep(600 * 2 ** (attempt - 1));
  }
}

function toArg(p: BsParam): unknown {
  const t = p.type ?? "";
  const v = p.value;
  if (/^u?int/.test(t)) return BigInt(String(v));
  if (t === "bool") return v === true || v === "true";
  return v;
}

/** Explorer gave us `{ method_call: "PayeeChangedRecently(address payee, uint64 cooldownEnds)", parameters }`. */
function fromExplorerDecoding(rr: { method_call?: unknown; parameters?: unknown }) {
  const call = typeof rr.method_call === "string" ? rr.method_call : "";
  const name = call.split("(")[0] || "";
  if (!name) return null;
  const params = Array.isArray(rr.parameters) ? (rr.parameters as BsParam[]) : [];
  try {
    const data = encodeErrorResult({ abi: symbolonAbi, errorName: name as never, args: params.map(toArg) as never });
    const r = decodeRefusal(data);
    if (r) return r;
  } catch {
    // fall through to name only
  }
  return { name, args: params.map((p) => p.value), human: `${name} (decoded by the explorer).` };
}

function classify(tx: BsTx): MinedRefusal {
  const rr = tx.revert_reason;
  let decoded: { name: string; human: string; args: readonly unknown[] } | null = null;
  let decodedFrom: MinedRefusal["decodedFrom"] = "none";

  if (rr && typeof rr === "object") {
    const r = rr as { raw?: unknown; method_call?: unknown; parameters?: unknown };
    if (typeof r.raw === "string" && /^0x[0-9a-fA-F]{8,}$/.test(r.raw)) {
      decoded = decodeRefusal(r.raw as Hex);
      if (decoded) decodedFrom = "revert data";
    }
    if ((!decoded || decoded.name === "Unknown") && r.method_call) {
      const e = fromExplorerDecoding(r);
      if (e) {
        decoded = e;
        decodedFrom = "explorer decoding";
      }
    }
  }
  if (!decoded) {
    decoded = {
      name: "NoRevertData",
      args: [],
      human: `The transaction reverted without a named error (explorer result: ${tx.result ?? "unknown"}), e.g. out of gas.`,
    };
  }

  const idParam = tx.decoded_input?.parameters?.find((p) => p.name === "id" && p.type === "bytes32");
  return {
    hash: tx.hash,
    blockNumber: BigInt(tx.block_number ?? tx.block ?? 0),
    timestamp: tx.timestamp ?? null,
    method: tx.method ?? null,
    from: tx.from?.hash ?? null,
    obligationId: typeof idParam?.value === "string" ? (idParam.value.toLowerCase() as Hex) : null,
    ...decoded,
    decodedFrom,
  };
}

const isReverted = (tx: BsTx) => tx.status === "error" || (typeof tx.result === "string" && tx.result !== "success" && tx.result !== "pending");

/**
 * The explorer sometimes returns no revert data for a reverted tx. Replay the exact call (same sender, same input) at
 * the parent block and read the revert data the contract returns. Results are cached per tx hash: they never change.
 */
const replayCache = new Map<string, { name: string; human: string; args: readonly unknown[] } | null>();
async function replay(tx: BsTx) {
  if (replayCache.has(tx.hash)) return replayCache.get(tx.hash)!;
  let out: { name: string; human: string; args: readonly unknown[] } | null = null;
  const block = BigInt(tx.block_number ?? tx.block ?? 0);
  if (tx.raw_input && tx.from?.hash && block > 0n) {
    try {
      await client.call({ account: tx.from.hash as Hex, to: SYMBOLON, data: tx.raw_input as Hex, blockNumber: block - 1n, gas: 300_000n });
    } catch (e) {
      const data = e instanceof BaseError ? (e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null)?.data : undefined;
      if (data && data !== "0x") out = decodeRefusal(data);
    }
  }
  replayCache.set(tx.hash, out);
  return out;
}

const isSymbolonCall = (tx: BsTx) =>
  typeof tx.raw_input === "string" && tx.raw_input.length >= 10 && SELECTORS.has(tx.raw_input.slice(0, 10).toLowerCase());

async function scan(): Promise<RefusalIndex> {
  const refusals: MinedRefusal[] = [];
  let otherReverted = 0;
  let scannedTxs = 0;
  let params: BsPage["next_page_params"] = null;
  let pages = 0;
  do {
    const page = await fetchPage(params);
    const items = page.items ?? [];
    scannedTxs += items.length;
    for (const tx of items) {
      if (!isReverted(tx)) continue;
      if (!isSymbolonCall(tx)) {
        otherReverted++;
        continue;
      }
      const r = classify(tx);
      if (r.decodedFrom === "none") {
        const rep = await replay(tx);
        if (rep) Object.assign(r, rep, { decodedFrom: "replay" as const });
      }
      refusals.push(r);
    }
    params = page.next_page_params ?? null;
    pages++;
  } while (params && pages < MAX_PAGES);
  // newest first, by block number (never timestamp)
  refusals.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
  return { refusals, otherReverted, scannedTxs, truncated: Boolean(params) };
}

export function getRefusals() {
  return memo("refusals", SNAPSHOT_TTL_MS, scan);
}
