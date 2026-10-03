import { decodeEventLog, type Hex, type Log } from "viem";
import { MAX_LOG_RANGE, SYSTEM_EMITTER, symbolonAbi } from "@symbolon/sdk";
import { client } from "./client";
import { DEPLOY_BLOCK, SNAPSHOT_TTL_MS, SYMBOLON } from "./config";
import { memo } from "./memo";

/**
 * Incremental, process-local index of every event the Symbolon contract has emitted.
 *
 * Arc gotchas this handles (measured):
 * - eth_getLogs is capped near 10,000 blocks (-32012), so ranges are read in MAX_LOG_RANGE chunks.
 * - A 429 / throttle is not a range error: back off and retry the same range, never shrink it.
 * - Public RPCs are load-balanced across backends at different heights. A lagging backend answers a range it
 *   has not seen with an empty list, so the newest TAIL blocks are re-read on every sync and never committed.
 * - Events are ordered by (blockNumber, logIndex), never by timestamp (Arc timestamps can repeat).
 */

export type ChainEvent = {
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
};

const TAIL = 64n; // ~30 s of Arc blocks, re-read each sync
const CONCURRENCY = 6;
const MAX_ATTEMPTS = 5;

const state = {
  committedTo: DEPLOY_BLOCK - 1n,
  committed: [] as ChainEvent[],
};

function codeOf(e: unknown): { code?: number; status?: number; text: string } {
  let cur: unknown = e;
  let code: number | undefined;
  let status: number | undefined;
  const parts: string[] = [];
  for (let i = 0; cur && i < 8; i++) {
    const c = cur as { code?: unknown; status?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "number" && code === undefined) code = c.code;
    if (typeof c.status === "number" && status === undefined) status = c.status;
    if (typeof c.message === "string") parts.push(c.message);
    cur = c.cause;
  }
  return { code, status, text: parts.join(" | ").toLowerCase() };
}

const isThrottle = (e: unknown) => {
  const { code, status, text } = codeOf(e);
  return status === 429 || code === 429 || /429|too many requests|rate limit|throttl/.test(text);
};
const isRangeError = (e: unknown) => {
  const { code, text } = codeOf(e);
  return code === -32012 || /block range|range too large|exceed.*range/.test(text);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getRange(from: bigint, to: bigint): Promise<Log[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.getLogs({ address: SYMBOLON, fromBlock: from, toBlock: to });
    } catch (e) {
      if (isRangeError(e) && to > from) {
        // A genuine range cap (only if MAX_LOG_RANGE is ever too large): split the range.
        const mid = from + (to - from) / 2n;
        return [...(await getRange(from, mid)), ...(await getRange(mid + 1n, to))];
      }
      if (attempt >= MAX_ATTEMPTS) throw e;
      // Throttled or transient: back off, same range.
      await sleep((isThrottle(e) ? 800 : 300) * 2 ** (attempt - 1));
    }
  }
}

function decode(logs: Log[]): ChainEvent[] {
  const out: ChainEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() === SYSTEM_EMITTER) continue;
    if (log.address.toLowerCase() !== SYMBOLON.toLowerCase()) continue;
    if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) continue;
    try {
      const d = decodeEventLog({ abi: symbolonAbi, data: log.data, topics: log.topics });
      out.push({
        name: d.eventName,
        args: (d.args ?? {}) as Record<string, unknown>,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        txHash: log.transactionHash,
      });
    } catch {
      // not a Symbolon event signature; ignore
    }
  }
  return out;
}

function chunks(from: bigint, to: bigint): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let s = from; s <= to; s += MAX_LOG_RANGE) {
    const e = s + MAX_LOG_RANGE - 1n;
    out.push([s, e < to ? e : to]);
  }
  return out;
}

const byChainOrder = (a: ChainEvent, b: ChainEvent) =>
  a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

async function sync(): Promise<{ events: ChainEvent[]; head: bigint }> {
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const commitTarget = head - TAIL;

  // 1. Advance the committed index in batches; progress from completed batches is kept even if a later one fails.
  const pending = commitTarget > state.committedTo ? chunks(state.committedTo + 1n, commitTarget) : [];
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(([f, t]) => getRange(f, t)));
    state.committed.push(...decode(results.flat()));
    state.committedTo = batch[batch.length - 1]![1];
  }

  // 2. The volatile tail: read fresh, never committed.
  const tailFrom = state.committedTo + 1n;
  const tail = tailFrom <= head ? decode(await getRange(tailFrom, head)) : [];

  const events = [...state.committed, ...tail].sort(byChainOrder);
  return { events, head };
}

/** Every Symbolon event since deployment, in chain order, plus the head block the snapshot was taken at. */
export function getEvents() {
  return memo("events", SNAPSHOT_TTL_MS, sync);
}
