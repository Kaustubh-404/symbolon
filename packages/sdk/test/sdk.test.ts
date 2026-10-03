import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  obligationId,
  payeeId,
  canonicalJson,
  hashRecord,
  feePolicy,
  bumpFees,
  FEE_FLOOR,
  decodeRefusal,
  NonceSafeSender,
  MemoryJournal,
} from "../src/index.js";

const GWEI = 1_000_000_000n;

describe("ids", () => {
  it("matches `cast keccak` used in the on-chain smoke run", () => {
    // values from docs/deployments.md smoke run
    expect(obligationId("Purchase Invoice", "ACC-PINV-SMOKE-0001")).toBe("0x34e4b5eab3451713981cb4f60dd79a244690088c740ae9ac3b815f22cbc2a68c");
    expect(payeeId("Supplier", "TEST-VENDOR-01")).toBe("0xb4e1d4e768b8a529f8b835b640c372264af7032fc94ba8f6efcac718742cc645");
  });

  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })).toBe('{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(hashRecord({ x: 1, y: 2 })).toBe(hashRecord({ y: 2, x: 1 }));
  });
});

describe("fee policy", () => {
  it("never goes under the floor, even if an RPC reports a base fee below Arc's 20 gwei minimum", () => {
    expect(feePolicy(0n).maxFeePerGas).toBe(40n * GWEI); // clamped to 20 gwei, then 2x
    expect(feePolicy(20n * GWEI).maxFeePerGas).toBeGreaterThanOrEqual(FEE_FLOOR);
  });
  it("keeps 2x headroom over a rising base fee", () => {
    expect(feePolicy(40n * GWEI).maxFeePerGas).toBe(80n * GWEI);
  });
  it("replacement bumps both fields by more than 10%", () => {
    const prev = { maxFeePerGas: 30n * GWEI, maxPriorityFeePerGas: 1n * GWEI };
    const b = bumpFees(prev, 20n * GWEI);
    expect(b.maxFeePerGas * 100n).toBeGreaterThan(prev.maxFeePerGas * 110n);
    expect(b.maxPriorityFeePerGas * 100n).toBeGreaterThan(prev.maxPriorityFeePerGas * 110n);
  });
});

describe("refusals", () => {
  it("decodes the refusal mined in the smoke run", () => {
    // check() output captured from Arc Testnet, 2026-10-03
    const data =
      "0x8d5e4bc0000000000000000000000000676e9eacd4feb3322295ab5e399d7c316e26013b000000000000000000000000000000000000000000000000000000006ac25396" as Hex;
    const r = decodeRefusal(data)!;
    expect(r.name).toBe("PayeeChangedRecently");
    expect(r.human).toContain("changed recently");
    expect(r.human).toContain("2026-10-04");
  });
  it("returns null for an empty result (releasable)", () => {
    expect(decodeRefusal("0x")).toBeNull();
  });
});

/**
 * A fake Arc: transactions priced under the base fee are accepted and never mine (as measured on Arc Testnet).
 * Proves the sender never takes a second nonce for one intent, and recovers by same-nonce replacement.
 */
function fakeArc(baseFee = 20n * GWEI) {
  const mined = new Map<Hex, { blockNumber: bigint; status: "success" }>();
  const pool = new Map<number, { hash: Hex; maxFee: bigint }>();
  let latestNonce = 0;
  let n = 0;
  const sent: { nonce: number; maxFee: bigint; hash: Hex }[] = [];
  const pub = {
    getTransactionCount: async ({ blockTag }: { blockTag: string }) =>
      blockTag === "pending" ? Math.max(latestNonce, ...[...pool.keys()].map((k) => k + 1)) : latestNonce,
    getBlock: async () => ({ baseFeePerGas: baseFee }),
    estimateGas: async () => 100_000n,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = mined.get(hash);
      if (!r) throw new Error("not found");
      return { ...r, transactionHash: hash };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = mined.get(hash);
      if (!r) throw new Error("timeout");
      return { ...r, transactionHash: hash };
    },
  };
  const wallet = {
    account: { address: "0x00000000000000000000000000000000000000a1" as Hex },
    sendTransaction: async ({ nonce, maxFeePerGas }: { nonce: number; maxFeePerGas: bigint }) => {
      const hash = `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
      sent.push({ nonce, maxFee: maxFeePerGas, hash });
      pool.set(nonce, { hash, maxFee: maxFeePerGas });
      if (maxFeePerGas >= baseFee && !stuckNext.value) {
        mined.set(hash, { blockNumber: 1n, status: "success" });
        pool.delete(nonce);
        latestNonce = Math.max(latestNonce, nonce + 1);
      }
      stuckNext.value = false;
      return hash;
    },
  };
  const stuckNext = { value: false };
  return { pub, wallet, sent, stuckNext };
}

describe("NonceSafeSender", () => {
  const req = { key: "release:0xabc", to: "0x00000000000000000000000000000000000000b2" as Hex, data: "0x" as Hex };

  it("a retried intent never signs a second nonce", async () => {
    const arc = fakeArc();
    const journal = new MemoryJournal();
    const s = new NonceSafeSender(arc.pub as never, arc.wallet as never, journal);
    const a = await s.send(req);
    const b = await s.send(req); // the retry
    expect(a.hash).toBe(b.hash);
    expect(b.deduplicated).toBe(true);
    expect(arc.sent).toHaveLength(1);
  });

  it("a stuck tx is replaced at the SAME nonce with a higher fee", async () => {
    const arc = fakeArc();
    const journal = new MemoryJournal();
    const s = new NonceSafeSender(arc.pub as never, arc.wallet as never, journal, { receiptTimeoutMs: 1, maxReplacements: 3 });
    arc.stuckNext.value = true; // first broadcast will not mine
    const r = await s.send(req);
    expect(arc.sent).toHaveLength(2);
    expect(arc.sent[0]!.nonce).toBe(arc.sent[1]!.nonce);
    expect(arc.sent[1]!.maxFee).toBeGreaterThan(arc.sent[0]!.maxFee);
    expect(r.hash).toBe(arc.sent[1]!.hash);
    expect(journal.get(req.key)!.status).toBe("mined");
  });

  it("distinct intents get distinct nonces", async () => {
    const arc = fakeArc();
    const s = new NonceSafeSender(arc.pub as never, arc.wallet as never, new MemoryJournal());
    await s.send(req);
    await s.send({ ...req, key: "release:0xdef" });
    expect(arc.sent.map((x) => x.nonce)).toEqual([0, 1]);
  });
});
