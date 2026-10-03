import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, type Hex } from "viem";
import {
  ACTION_CODE,
  CircleMint,
  NonceSafeSender,
  decisionHash,
  explorerTx,
  hashRecord,
  idempotencyUuid,
  symbolonAbi,
  usdToUnits,
  unitsToUsd,
  type DecisionRecord,
} from "@symbolon/sdk";
import type { Bill } from "./books.js";
import type { ChainReader } from "./chain.js";
import type { DecisionInput } from "./tools.js";

/**
 * Turns the model's proposals into actions — in code, through the contract. The order is the point:
 *   1. commit the decision hash on-chain (the model's output becomes an INPUT, on the record)
 *   2. fund exactly this bill from Circle Mint into the vault (issuing new USDC first if needed)
 *   3. hand the funding claim to the witness, and wait for its independent attestation
 *   4. dry-run, then release — or record the contract's refusal
 * Every on-chain step goes through NonceSafeSender with an intent key derived from the bill, so a crashed or
 * retried run can never commit, fund or release twice.
 */

export type ExecConfig = {
  chainId: number;
  chain: ChainReader;
  sender: NonceSafeSender;
  mint: CircleMint | null;
  /** Mint recipient id of the vault address (registered and console-approved once) */
  vaultRecipientId: string | null;
  /** Mint sandbox wire details, for mint_issue */
  wire: { trackingRef: string; beneficiaryAccountNumber: string } | null;
  claimsDir: string;
  decisionsDir: string;
  today: string;
  model: string;
  promptHash: Hex;
  witnessTimeoutMs: number;
};

export type ExecResult = {
  obligationId: Hex;
  document: string;
  action: DecisionInput["action"];
  decisionHash: Hex;
  commitTx?: Hex;
  fundingTransferId?: string;
  released?: Hex;
  refusal?: { name: string; human: string };
  note?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function execute(cfg: ExecConfig, bill: Bill, d: DecisionInput): Promise<ExecResult> {
  mkdirSync(cfg.decisionsDir, { recursive: true });
  mkdirSync(cfg.claimsDir, { recursive: true });
  const o = await cfg.chain.obligation(bill.obligationId);

  const record: DecisionRecord = {
    schema: "symbolon.decision/v1",
    obligationId: bill.obligationId,
    action: d.action,
    payDate: d.payDate,
    fundingSource: d.fundingSource === "mint_balance" ? "float" : d.fundingSource === "mint_issue" ? "mint_issue" : "none",
    discountCaptured:
      d.action === "pay" && bill.discount && d.payDate && d.payDate <= bill.discount.untilDate
        ? ((usdToUnits(bill.amountUsd) * BigInt(Math.round(bill.discount.percent * 100))) / 10_000n).toString()
        : "0",
    rationale: d.rationale + (d.concerns.length ? `\nConcerns: ${d.concerns.join("; ")}` : ""),
    alternatives: d.alternatives,
    inputs: {
      calendarHash: hashRecord({ today: cfg.today, bill: { ...bill, untrustedText: undefined } }),
      balancesHash: hashRecord(await cfg.chain.treasury()),
      documentHash: o.docHash,
    },
    model: cfg.model,
    promptHash: cfg.promptHash,
    decidedAt: new Date().toISOString(),
  };
  const h = decisionHash(record);
  // Served publicly at /decisions/<hash>: anyone can re-hash it and compare with the on-chain commit.
  writeFileSync(join(cfg.decisionsDir, `${h}.json`), JSON.stringify(record, null, 2));
  const res: ExecResult = { obligationId: bill.obligationId, document: bill.name, action: d.action, decisionHash: h };

  if (o.status === 0) return { ...res, note: "not registered on-chain yet (no human approval); decision recorded off-chain only" };
  if (o.status !== 1) return { ...res, note: `already ${["", "", "released", "cancelled", "expired"][o.status]}` };

  // 1. commit — skip if this exact decision is already on-chain
  if (o.decisionHash.toLowerCase() !== h.toLowerCase()) {
    const c = await cfg.sender.send({
      key: `commit:${bill.obligationId}:${h}`,
      to: cfg.chain.vault,
      data: encodeFunctionData({ abi: symbolonAbi, functionName: "commitDecision", args: [bill.obligationId, ACTION_CODE[d.action], h] }),
    });
    res.commitTx = c.hash;
  }
  if (d.action !== "pay") return res;
  if (d.payDate && d.payDate > cfg.today) return { ...res, note: `scheduled for ${d.payDate}` };

  // 2. fund this bill, exactly, from Circle Mint (skip if the witness already saw funding)
  const witnessed = o.witnessDigest !== `0x${"0".repeat(64)}`;
  if (!witnessed) {
    if (!cfg.mint || !cfg.vaultRecipientId) return { ...res, note: "no Circle Mint configuration; cannot fund" };
    const amount = unitsToUsd(o.amount);
    if (d.fundingSource === "mint_issue") await issue(cfg, o.amount);
    const t = await cfg.mint.createTransfer(idempotencyUuid("symbolon:fund", bill.obligationId), cfg.vaultRecipientId, amount);
    res.fundingTransferId = t.data.id;
    const claimPath = join(cfg.claimsDir, `${bill.obligationId}.json`);
    if (!existsSync(claimPath)) {
      writeFileSync(claimPath, JSON.stringify({ obligationId: bill.obligationId, mintTransferId: t.data.id, claimedBy: "agent", at: new Date().toISOString() }, null, 2));
    }
    // 3. the witness decides, independently; we only wait
    const deadline = Date.now() + cfg.witnessTimeoutMs;
    while (Date.now() < deadline) {
      const now = await cfg.chain.obligation(bill.obligationId);
      if (now.witnessDigest !== `0x${"0".repeat(64)}`) break;
      await sleep(5_000);
    }
  }

  // 4. dry run, then release
  const refusal = await cfg.chain.check(bill.obligationId);
  if (refusal) return { ...res, refusal: { name: refusal.name, human: refusal.human } };
  const r = await cfg.sender.send({
    key: `release:${bill.obligationId}`,
    to: cfg.chain.vault,
    data: encodeFunctionData({ abi: symbolonAbi, functionName: "release", args: [bill.obligationId] }),
  });
  res.released = r.hash;
  res.note = explorerTx(cfg.chainId, r.hash);
  return res;
}

/** Sandbox issuance: wire in the shortfall so Circle issues new USDC into the Mint balance, then wait for it. */
async function issue(cfg: ExecConfig, needed: bigint) {
  if (!cfg.mint || !cfg.wire) throw new Error("mint_issue needs Circle Mint wire configuration");
  const available = async () =>
    usdToUnits((await cfg.mint!.balances()).data.available.find((m) => m.currency === "USD")?.amount ?? "0");
  const have = await available();
  if (have >= needed) return;
  const shortfall = needed - have;
  await cfg.mint.mockWire(cfg.wire.trackingRef, cfg.wire.beneficiaryAccountNumber, unitsToUsd(shortfall));
  const deadline = Date.now() + 20 * 60_000; // sandbox wires settle in batches, up to ~15 minutes
  while (Date.now() < deadline) {
    if ((await available()) >= needed) return;
    await sleep(15_000);
  }
  throw new Error(`issuance of ${unitsToUsd(shortfall)} did not settle in time`);
}
