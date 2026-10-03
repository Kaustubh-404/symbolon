import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { Account, Chain, Hex, PublicClient, TransactionReceipt, Transport, WalletClient } from "viem";
import { MIN_BASE_FEE_WEI } from "./chains.js";

/**
 * NonceSafeSender: the only way Symbolon services put a transaction on Arc.
 *
 * Measured on Arc Testnet (docs/platform-notes.md): a tx priced under the base fee that skips gas estimation is
 * ACCEPTED by the RPC, returns a hash, never mines, and holds its nonce. A caller that times out and "retries" with
 * a fresh nonce queues a second payment behind the first; when fees allow, both land. That is the
 * double-payment-on-retry the Agents and Ledgers essay describes, reproduced on Arc.
 *
 * Rules enforced here:
 *  1. Every send has an intent key (e.g. "release:<obligationId>"). It is journaled BEFORE signing.
 *  2. If the journal already holds that intent, we never sign a new nonce. We look up its receipt; if it is
 *     stuck we REPLACE it at the SAME nonce with a higher fee; if it mined, we return the existing receipt.
 *  3. Fees: maxFee >= max(2 × baseFee, 30 gwei). Never below Arc's 20 gwei floor.
 */

export type IntentStatus = "signing" | "sent" | "mined" | "reverted" | "stuck";

export type IntentEntry = {
  key: string;
  from: Hex;
  nonce: number;
  maxFeePerGas: string; // decimal strings: JSON-safe bigint
  maxPriorityFeePerGas: string;
  hashes: Hex[]; // every broadcast for this nonce, oldest first (replacements append)
  status: IntentStatus;
  blockNumber?: string;
  createdAt: string;
  updatedAt: string;
};

export interface Journal {
  get(key: string): IntentEntry | undefined;
  put(entry: IntentEntry): void;
  all(): IntentEntry[];
}

export class MemoryJournal implements Journal {
  private m = new Map<string, IntentEntry>();
  get(key: string) {
    return this.m.get(key);
  }
  put(e: IntentEntry) {
    this.m.set(e.key, structuredClone(e));
  }
  all() {
    return [...this.m.values()];
  }
}

/** Write-ahead journal on disk. Writes are atomic (tmp + rename) so a crash never leaves half an entry. */
export class FileJournal implements Journal {
  private m: Map<string, IntentEntry>;
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.m = existsSync(path)
      ? new Map((JSON.parse(readFileSync(path, "utf8")) as IntentEntry[]).map((e) => [e.key, e]))
      : new Map();
  }
  get(key: string) {
    return this.m.get(key);
  }
  put(e: IntentEntry) {
    this.m.set(e.key, e);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.m.values()], null, 2));
    renameSync(tmp, this.path);
  }
  all() {
    return [...this.m.values()];
  }
}

const GWEI = 1_000_000_000n;
export const FEE_FLOOR = 30n * GWEI;
export const PRIORITY_FEE = 1n * GWEI;

/** Pure fee policy, unit-tested: never under Arc's base-fee floor, always headroom for a base-fee rise. */
export function feePolicy(baseFee: bigint): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const base = baseFee < MIN_BASE_FEE_WEI ? MIN_BASE_FEE_WEI : baseFee;
  const twice = 2n * base;
  return { maxFeePerGas: twice > FEE_FLOOR ? twice : FEE_FLOOR, maxPriorityFeePerGas: PRIORITY_FEE };
}

/** Replacement fees must exceed the original by >= 10% on both fields to be accepted; we bump by 25%. */
export function bumpFees(prev: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, baseFee: bigint) {
  const fresh = feePolicy(baseFee);
  const bump = (x: bigint) => (x * 125n) / 100n + 1n;
  const maxFee = bump(prev.maxFeePerGas) > fresh.maxFeePerGas ? bump(prev.maxFeePerGas) : fresh.maxFeePerGas;
  const prio = bump(prev.maxPriorityFeePerGas);
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
}

export type SendRequest = {
  /** idempotency key for this intent, derived from business data, never random */
  key: string;
  to: Hex;
  data: Hex;
  gas?: bigint;
  /** if true, a call that would revert is still broadcast (with `gas` required), so the refusal is mined on-chain */
  mineRefusal?: boolean;
};

export type SendResult = {
  key: string;
  hash: Hex;
  receipt: TransactionReceipt;
  /** true if this call found the intent already journaled and did not sign anything new */
  deduplicated: boolean;
  replacements: number;
};

export class NonceSafeSender {
  constructor(
    private pub: PublicClient<Transport, Chain>,
    private wallet: WalletClient<Transport, Chain, Account>,
    private journal: Journal,
    private opts: { receiptTimeoutMs?: number; maxReplacements?: number } = {},
  ) {}

  get address(): Hex {
    return this.wallet.account.address;
  }

  async send(req: SendRequest): Promise<SendResult> {
    const existing = this.journal.get(req.key);
    if (existing) return this.resume(existing, req);

    const nonce = await this.pub.getTransactionCount({ address: this.address, blockTag: "pending" });
    const block = await this.pub.getBlock({ blockTag: "latest" });
    const fees = feePolicy(block.baseFeePerGas ?? MIN_BASE_FEE_WEI);
    const gas = req.gas ?? (await this.pub.estimateGas({ account: this.address, to: req.to, data: req.data }));
    const now = new Date().toISOString();
    const entry: IntentEntry = {
      key: req.key,
      from: this.address,
      nonce,
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      hashes: [],
      status: "signing",
      createdAt: now,
      updatedAt: now,
    };
    this.journal.put(entry); // write-ahead: the intent exists before any signature does
    const hash = await this.broadcast(req, entry, gas, fees);
    return this.await(entry, req, gas, hash, false);
  }

  private async resume(entry: IntentEntry, req: SendRequest): Promise<SendResult> {
    // A previous attempt exists. Never take a new nonce for this intent.
    for (const h of [...entry.hashes].reverse()) {
      const r = await this.pub.getTransactionReceipt({ hash: h }).catch(() => null);
      if (r) return this.finish(entry, h, r, true, entry.hashes.length - 1);
    }
    const latestNonce = await this.pub.getTransactionCount({ address: this.address, blockTag: "latest" });
    if (latestNonce > entry.nonce) {
      // the nonce was consumed by a hash we never saw (e.g. crash between broadcast and journal update)
      throw new Error(`intent ${entry.key}: nonce ${entry.nonce} consumed by an unjournaled tx; refusing to guess`);
    }
    const gas = req.gas ?? (await this.pub.estimateGas({ account: this.address, to: req.to, data: req.data }));
    const block = await this.pub.getBlock({ blockTag: "latest" });
    const fees =
      entry.hashes.length === 0
        ? feePolicy(block.baseFeePerGas ?? MIN_BASE_FEE_WEI)
        : bumpFees(
            { maxFeePerGas: BigInt(entry.maxFeePerGas), maxPriorityFeePerGas: BigInt(entry.maxPriorityFeePerGas) },
            block.baseFeePerGas ?? MIN_BASE_FEE_WEI,
          );
    const hash = await this.broadcast(req, entry, gas, fees);
    return this.await(entry, req, gas, hash, true);
  }

  private async broadcast(
    req: SendRequest,
    entry: IntentEntry,
    gas: bigint,
    fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
  ): Promise<Hex> {
    const hash = await this.wallet.sendTransaction({
      to: req.to,
      data: req.data,
      gas,
      nonce: entry.nonce,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    entry.hashes.push(hash);
    entry.maxFeePerGas = fees.maxFeePerGas.toString();
    entry.maxPriorityFeePerGas = fees.maxPriorityFeePerGas.toString();
    entry.status = "sent";
    entry.updatedAt = new Date().toISOString();
    this.journal.put(entry);
    return hash;
  }

  private async await(entry: IntentEntry, req: SendRequest, gas: bigint, hash: Hex, dedup: boolean): Promise<SendResult> {
    const timeout = this.opts.receiptTimeoutMs ?? 30_000;
    const maxRepl = this.opts.maxReplacements ?? 3;
    let current = hash;
    for (let attempt = 0; ; attempt++) {
      try {
        const receipt = await this.pub.waitForTransactionReceipt({ hash: current, timeout, pollingInterval: 1_000 });
        return this.finish(entry, current, receipt, dedup, entry.hashes.length - 1);
      } catch {
        // maybe an earlier broadcast of the same nonce mined instead
        for (const h of entry.hashes) {
          const r = await this.pub.getTransactionReceipt({ hash: h }).catch(() => null);
          if (r) return this.finish(entry, h, r, dedup, entry.hashes.length - 1);
        }
        entry.status = "stuck";
        entry.updatedAt = new Date().toISOString();
        this.journal.put(entry);
        if (attempt >= maxRepl) throw new Error(`intent ${entry.key} stuck at nonce ${entry.nonce} after ${attempt} replacements`);
        const block = await this.pub.getBlock({ blockTag: "latest" });
        const fees = bumpFees(
          { maxFeePerGas: BigInt(entry.maxFeePerGas), maxPriorityFeePerGas: BigInt(entry.maxPriorityFeePerGas) },
          block.baseFeePerGas ?? MIN_BASE_FEE_WEI,
        );
        current = await this.broadcast(req, entry, gas, fees); // SAME nonce, higher fee
      }
    }
  }

  private finish(entry: IntentEntry, hash: Hex, receipt: TransactionReceipt, dedup: boolean, replacements: number): SendResult {
    entry.status = receipt.status === "success" ? "mined" : "reverted";
    entry.blockNumber = receipt.blockNumber.toString();
    entry.updatedAt = new Date().toISOString();
    this.journal.put(entry);
    return { key: entry.key, hash, receipt, deduplicated: dedup, replacements: Math.max(0, replacements) };
  }
}
