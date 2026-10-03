import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CircleMint,
  FileJournal,
  NonceSafeSender,
  arcTransport,
  chainFor,
  deployments,
  explorerTx,
  symbolonAbi,
  unitsToUsd,
} from "@symbolon/sdk";
import { verifyFunding, type ChainEvidence } from "./verify.js";

/**
 * The witness service. It holds the WITNESS key and nothing else; the contract forbids that key from also being
 * the agent, approver or cosigner.
 *
 * Input: funding claims ("obligation X was funded by Circle Mint transfer T"), written by whoever moved the money
 * (normally the agent). The witness trusts nothing in a claim except the two ids: it fetches Circle's record
 * itself, fetches the chain receipt itself, and decides with verifyFunding().
 *
 * Output: an on-chain attestation, and an evidence file containing the exact bytes Circle served, so anyone can
 * re-hash them and compare with the on-chain witnessDigest.
 */

type Claim = { obligationId: Hex; mintTransferId: string; claimedBy?: string; at?: string };

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const chainId = Number(env("CHAIN_ID", "5042002"));
const dep = deployments[String(chainId) as keyof typeof deployments];
if (!dep) throw new Error(`no deployment for chain ${chainId}`);
const vault = dep.symbolon as Hex;
const dataDir = env("WITNESS_DATA_DIR", ".data/witness");
const claimsDir = env("CLAIMS_DIR", ".data/claims");
const evidenceDir = join(dataDir, "evidence");
const usedPath = join(dataDir, "used-transfers.json");
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(claimsDir, { recursive: true });

const chain = chainFor(chainId);
const pub = createPublicClient({ chain, transport: arcTransport(chainId) });
const account = privateKeyToAccount(env("WITNESS_PK") as Hex);
const wallet = createWalletClient({ chain, account, transport: arcTransport(chainId) });
const sender = new NonceSafeSender(pub, wallet, new FileJournal(join(dataDir, "journal.json")));
const mint = new CircleMint(env("CIRCLE_MINT_KEY"), env("CIRCLE_MINT_BASE", "https://api-sandbox.circle.com"));

const used = new Map<string, Hex>(existsSync(usedPath) ? (JSON.parse(readFileSync(usedPath, "utf8")) as [string, Hex][]) : []);
const saveUsed = () => writeFileSync(usedPath, JSON.stringify([...used.entries()], null, 2));

function readClaims(): Claim[] {
  return readdirSync(claimsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(claimsDir, f), "utf8")) as Claim);
}

const evidencePath = (id: Hex) => join(evidenceDir, `${id}.json`);

async function chainEvidence(hash: Hex): Promise<ChainEvidence | null> {
  const r = await pub.getTransactionReceipt({ hash }).catch(() => null);
  if (!r) return null;
  return {
    txHash: r.transactionHash,
    status: r.status,
    blockNumber: r.blockNumber,
    logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
  };
}

async function handle(c: Claim) {
  const done = evidencePath(c.obligationId);
  if (existsSync(done) && (JSON.parse(readFileSync(done, "utf8")) as { final?: boolean }).final) return;

  const o = await pub.readContract({ address: vault, abi: symbolonAbi, functionName: "getObligation", args: [c.obligationId] });
  const { data: transfer, raw } = await mint.getTransfer(c.mintTransferId);
  const ev = transfer.transactionHash ? await chainEvidence(transfer.transactionHash as Hex) : null;
  const verdict = verifyFunding({
    obligation: { id: c.obligationId, amount: o.amount, status: o.status, witnessDigest: o.witnessDigest },
    vault,
    transfer,
    transferRaw: raw,
    chain: ev,
    used,
  });

  const base = {
    schema: "symbolon.witness/v1",
    obligationId: c.obligationId,
    claim: c,
    circle: { endpoint: `GET /v1/businessAccount/transfers/${c.mintTransferId}`, rawResponse: raw },
    chain: ev ? { txHash: ev.txHash, blockNumber: ev.blockNumber.toString(), status: ev.status } : null,
    checkedAt: new Date().toISOString(),
  };

  if (!verdict.attest) {
    writeFileSync(done, JSON.stringify({ ...base, verdict: "refused", reason: verdict.reason, final: !verdict.retryable }, null, 2));
    console.log(`[witness] ${verdict.retryable ? "waiting" : "REFUSED"} ${c.obligationId.slice(0, 10)}: ${verdict.reason}`);
    return;
  }

  const res = await sender.send({
    key: `witness:${c.obligationId}`,
    to: vault,
    data: encodeFunctionData({
      abi: symbolonAbi,
      functionName: "attestWitness",
      args: [c.obligationId, verdict.observedAmount, verdict.fundingRef, verdict.witnessDigest],
    }),
  });
  used.set(transfer.id, c.obligationId);
  saveUsed();
  writeFileSync(
    done,
    JSON.stringify(
      {
        ...base,
        verdict: verdict.mismatch ? "attested-mismatch" : "attested",
        observedAmountUsd: unitsToUsd(verdict.observedAmount),
        owedAmountUsd: unitsToUsd(o.amount),
        witnessDigest: verdict.witnessDigest,
        digestAlgorithm: "sha256 over circle.rawResponse bytes (UTF-8)",
        fundingRef: verdict.fundingRef,
        fundedFrom: verdict.chainFrom,
        attestTx: res.hash,
        attestTxUrl: explorerTx(chainId, res.hash),
        attestStatus: res.receipt.status,
        final: true,
      },
      null,
      2,
    ),
  );
  console.log(`[witness] attested ${c.obligationId.slice(0, 10)} $${unitsToUsd(verdict.observedAmount)}${verdict.mismatch ? " (MISMATCH: contract will refuse)" : ""} → ${res.hash}`);
}

async function tick() {
  for (const c of readClaims()) {
    try {
      await handle(c);
    } catch (e) {
      console.error(`[witness] error on ${c.obligationId.slice(0, 10)}:`, (e as Error).message);
    }
  }
}

const once = process.argv.includes("--once");
console.log(`[witness] ${account.address} watching vault ${vault} on chain ${chainId}; claims in ${claimsDir}`);
await tick();
if (!once) setInterval(tick, Number(env("WITNESS_INTERVAL_MS", "10000")));
