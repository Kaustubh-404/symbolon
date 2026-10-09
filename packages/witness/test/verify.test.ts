import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, pad, toBytes, type Hex } from "viem";
import type { MintTransfer } from "@symbolon/sdk";
import { USDC_ADDRESS, SYSTEM_EMITTER, digestEvidence } from "@symbolon/sdk";
import { verifyFunding, type ChainEvidence, type OpenObligation } from "../src/verify.js";

const VAULT = "0x06eADbFAd046F2784F6e894e153958E03EBf2Eb9" as Hex;
const OMNIBUS = "0x4E42177AB52202Ced872A5EF661dfc4794bB37bF" as Hex;
const TX = "0x9660be15a4459a6226b6e5b712cc766a67e90e98d2c8b5849e758f3d70762215" as Hex;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));

const ob = (amount: bigint, over: Partial<OpenObligation> = {}): OpenObligation => ({
  id: keccak256(toBytes("Purchase Invoice:T-1")),
  amount,
  status: 1,
  witnessDigest: ZERO32,
  ...over,
});

const transfer = (amount: string, over: Partial<MintTransfer> = {}): MintTransfer => ({
  id: "d9ad8724-6b1e-4ffd-856e-09ebf5395351",
  source: { type: "wallet", id: "1017508087" },
  destination: { type: "blockchain", address: VAULT.toLowerCase(), chain: "ARC" },
  amount: { amount, currency: "USD" },
  transactionHash: TX,
  status: "pending", // Circle's status lags the chain; measured
  createDate: "2026-10-01T18:12:49.962Z",
  ...over,
});

const usdcLog = (from: Hex, to: Hex, value: bigint, address: Hex = USDC_ADDRESS) => ({
  address,
  topics: [TRANSFER_TOPIC, pad(from), pad(to)] as Hex[],
  data: encodeAbiParameters([{ type: "uint256" }], [value]),
});

const chain = (logs: ChainEvidence["logs"], over: Partial<ChainEvidence> = {}): ChainEvidence => ({
  txHash: TX,
  status: "success",
  blockNumber: 64986887n,
  logs,
  ...over,
});

const raw = (t: MintTransfer) => JSON.stringify({ data: t });

describe("verifyFunding", () => {
  it("attests when Circle and the chain agree on an exact-amount transfer into the vault", () => {
    const t = transfer("5.00");
    const v = verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 5_000_000n)]), used: new Map() });
    expect(v.attest).toBe(true);
    if (v.attest) {
      expect(v.observedAmount).toBe(5_000_000n);
      expect(v.mismatch).toBe(false);
      expect(v.fundingRef).toBe(TX);
      expect(v.witnessDigest).toBe(digestEvidence(raw(t)));
      expect(v.chainFrom.toLowerCase()).toBe(OMNIBUS.toLowerCase());
    }
  });

  it("reports a short-funded bill truthfully so the contract refuses it loudly (WitnessMismatch)", () => {
    const t = transfer("4900.00");
    const v = verifyFunding({ obligation: ob(5_000_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 4_900_000_000n)]), used: new Map() });
    expect(v.attest && v.mismatch && v.observedAmount === 4_900_000_000n).toBe(true);
  });

  it("refuses when Circle and the chain disagree", () => {
    const t = transfer("5.00");
    const v = verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 4_000_000n)]), used: new Map() });
    expect(v).toMatchObject({ attest: false, retryable: false });
    if (!v.attest) expect(v.reason).toContain("ledgers disagree");
  });

  it("refuses to let one Circle transfer fund two bills", () => {
    const t = transfer("5.00");
    const other = keccak256(toBytes("Purchase Invoice:OTHER")) as Hex;
    const v = verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 5_000_000n)]), used: new Map([[t.id, other]]) });
    expect(v).toMatchObject({ attest: false, retryable: false });
  });

  it("accepts a NATIVE USDC payout (Circle Mint's real shape): system-emitter log, 18 decimals", () => {
    const t = transfer("5.00");
    const v = verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 5_000_000_000_000_000_000n, SYSTEM_EMITTER)]), used: new Map() });
    expect(v).toMatchObject({ attest: true, observedAmount: 5_000_000n });
  });

  it("never double counts: with both an ERC-20 log and a system-emitter log, only the ERC-20 view counts", () => {
    const t = transfer("5.00");
    const c = chain([usdcLog(OMNIBUS, VAULT, 5_000_000n), usdcLog(OMNIBUS, VAULT, 5_000_000_000_000_000_000n, SYSTEM_EMITTER)]);
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: c, used: new Map() })).toMatchObject({ attest: true, observedAmount: 5_000_000n });
  });

  it("ignores native dust that is not a whole micro-dollar", () => {
    const t = transfer("5.00");
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 5_000_000n, SYSTEM_EMITTER)]), used: new Map() })).toMatchObject({ attest: false });
  });

  it("waits (retryable) while Circle has no tx hash or the tx is not on Arc yet", () => {
    const t = transfer("5.00", { transactionHash: undefined });
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: null, used: new Map() })).toMatchObject({ attest: false, retryable: true });
    const t2 = transfer("5.00");
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t2, transferRaw: raw(t2), chain: null, used: new Map() })).toMatchObject({ attest: false, retryable: true });
  });

  it("refuses transfers that went somewhere other than the vault", () => {
    const t = transfer("5.00", { destination: { type: "blockchain", address: OMNIBUS, chain: "ARC" } });
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([]), used: new Map() })).toMatchObject({ attest: false, retryable: false });
  });

  it("refuses transfers on another chain", () => {
    const t = transfer("5.00", { destination: { type: "blockchain", address: VAULT, chain: "ETH" } });
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([]), used: new Map() })).toMatchObject({ attest: false });
  });

  it("refuses closed or already-witnessed obligations", () => {
    const t = transfer("5.00");
    const c = chain([usdcLog(OMNIBUS, VAULT, 5_000_000n)]);
    expect(verifyFunding({ obligation: ob(5_000_000n, { status: 2 }), vault: VAULT, transfer: t, transferRaw: raw(t), chain: c, used: new Map() })).toMatchObject({ attest: false });
    expect(verifyFunding({ obligation: ob(5_000_000n, { witnessDigest: keccak256("0x01") }), vault: VAULT, transfer: t, transferRaw: raw(t), chain: c, used: new Map() })).toMatchObject({ attest: false });
  });

  it("refuses a reverted funding tx", () => {
    const t = transfer("5.00");
    expect(verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: chain([usdcLog(OMNIBUS, VAULT, 5_000_000n)], { status: "reverted" }), used: new Map() })).toMatchObject({ attest: false });
  });

  it("the digest changes if a single byte of Circle's record changes", () => {
    const t = transfer("5.00");
    expect(digestEvidence(raw(t))).not.toBe(digestEvidence(raw({ ...t, createDate: "2026-10-01T18:12:49.963Z" })));
  });
});

describe("verifyFunding via treasury (Mint cannot pay a contract on ARC)", () => {
  const TREASURY = "0x676e9EacD4feB3322295ab5E399d7c316e26013b" as Hex;
  const FWD = "0x" + "f".repeat(64);
  const toTreasury = (amt: string) => transfer(amt, { destination: { type: "blockchain", address: TREASURY.toLowerCase(), chain: "ARC" } });
  const hop1 = (v: bigint) => chain([usdcLog(OMNIBUS, TREASURY, v)]);
  const hop2 = (v: bigint, over: Partial<ChainEvidence> = {}) =>
    chain([usdcLog(TREASURY, VAULT, v)], { txHash: FWD as Hex, blockNumber: 64986900n, ...over });
  const run = (t: MintTransfer, fwd: ChainEvidence | null, usedForwards = new Map<string, Hex>()) =>
    verifyFunding({ obligation: ob(5_000_000n), vault: VAULT, transfer: t, transferRaw: raw(t), chain: hop1(usdToUnitsLocal(t.amount.amount)), used: new Map(), treasury: TREASURY, forward: fwd, usedForwards });
  const usdToUnitsLocal = (a: string) => BigInt(Math.round(Number(a) * 1e6));

  it("attests when Circle → treasury and treasury → vault carry the same amount; fundingRef is the forward", () => {
    const v = run(toTreasury("5.00"), hop2(5_000_000n));
    expect(v.attest).toBe(true);
    if (v.attest) expect(v.fundingRef).toBe(FWD);
  });

  it("waits while funding sits in the treasury without a forward", () => {
    expect(run(toTreasury("5.00"), null)).toMatchObject({ attest: false, retryable: true });
  });

  it("refuses when the treasury forwards a different amount than Circle funded", () => {
    expect(run(toTreasury("5.00"), hop2(4_000_000n))).toMatchObject({ attest: false, retryable: false });
  });

  it("refuses a forward that went from somewhere other than the treasury", () => {
    const fwd = chain([usdcLog(OMNIBUS, VAULT, 5_000_000n)], { txHash: FWD as Hex, blockNumber: 64986900n });
    expect(run(toTreasury("5.00"), fwd)).toMatchObject({ attest: false });
  });

  it("refuses to reuse one forward for two bills", () => {
    const other = keccak256(toBytes("Purchase Invoice:OTHER")) as Hex;
    expect(run(toTreasury("5.00"), hop2(5_000_000n), new Map([[FWD, other]]))).toMatchObject({ attest: false, retryable: false });
  });

  it("refuses a forward older than Circle's funding", () => {
    expect(run(toTreasury("5.00"), hop2(5_000_000n, { blockNumber: 1n }))).toMatchObject({ attest: false, retryable: false });
  });
});
