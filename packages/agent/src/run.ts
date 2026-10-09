import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createWalletClient, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CircleMint, FileJournal, NonceSafeSender, arcTransport, chainFor } from "@symbolon/sdk";
import { ErpNextBooks, FileBooks, type Books } from "./books.js";
import { chainReader } from "./chain.js";
import { decide, MODEL } from "./decide.js";
import { execute, type ExecResult } from "./execute.js";
import { SYSTEM_PROMPT } from "./prompt.js";

/**
 * One agent, one authority: this process holds only the AGENT key. It cannot approve bills, attest funding or
 * co-sign; the contract rejects that key for those roles.
 */

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};
const opt = (k: string) => process.env[k] || null;

const chainId = Number(env("CHAIN_ID", "5042002"));
const dataDir = env("AGENT_DATA_DIR", ".data/agent");
const chain = chainReader(chainId);
const account = privateKeyToAccount(env("AGENT_PK") as Hex);
const wallet = createWalletClient({ chain: chainFor(chainId), account, transport: arcTransport(chainId) });
const sender = new NonceSafeSender(chain.pub, wallet, new FileJournal(join(dataDir, "journal.json")));
const mint = opt("CIRCLE_MINT_KEY") ? new CircleMint(env("CIRCLE_MINT_KEY")) : null;
const books: Books = opt("ERPNEXT_URL")
  ? new ErpNextBooks(env("ERPNEXT_URL"), env("ERPNEXT_TOKEN"))
  : new FileBooks(env("BOOKS_FILE", "fixtures/books.json"));
const client = new Anthropic();

async function runOnce() {
  const today = env("TODAY", new Date().toISOString().slice(0, 10));
  const bills = await books.openBills();
  console.log(`[agent] ${today}: ${bills.length} open bill(s); model ${MODEL}`);
  if (bills.length === 0) return;

  const out = await decide(client, { today, bills, chain, mint, annualYieldPct: Number(env("ANNUAL_YIELD_PCT", "4.5")) });
  console.log(`[agent] decided ${out.decisions.size} (defaulted to escalate: ${out.defaulted.length}); ${out.usage.iterations} model turns`);

  if (process.argv.includes("--decide-only")) {
    for (const b of bills) {
      const d = out.decisions.get(b.obligationId)!;
      console.log(`\n── ${b.name} (${b.partyName}, $${b.amountUsd}, due ${b.dueDate})\n   ${d.action.toUpperCase()}${d.payDate ? ` on ${d.payDate}` : ""} via ${d.fundingSource}\n   ${d.rationale}${d.concerns.length ? `\n   concerns: ${d.concerns.join("; ")}` : ""}`);
    }
    console.log(`\nsummary: ${out.summary}\nusage: ${JSON.stringify(out.usage)}`);
    return;
  }

  const results: ExecResult[] = [];
  for (const b of bills) {
    const d = out.decisions.get(b.obligationId)!;
    try {
      const r = await execute(
        {
          chainId,
          chain,
          sender,
          mint,
          vaultRecipientId: opt("MINT_VAULT_RECIPIENT_ID"),
          wire: opt("MINT_WIRE_TRACKING_REF")
            ? { trackingRef: env("MINT_WIRE_TRACKING_REF"), beneficiaryAccountNumber: env("MINT_WIRE_BENEFICIARY_ACCOUNT") }
            : null,
          claimsDir: env("CLAIMS_DIR", ".data/claims"),
          decisionsDir: join(dataDir, "decisions"),
          today,
          model: out.model,
          promptHash: keccak256(toBytes(SYSTEM_PROMPT)),
          witnessTimeoutMs: Number(env("WITNESS_TIMEOUT_MS", "180000")),
        },
        b,
        d,
      );
      results.push(r);
      console.log(`[agent] ${b.name}: ${d.action}${r.released ? ` → released ${r.released}` : ""}${r.refusal ? ` → REFUSED ${r.refusal.name}: ${r.refusal.human}` : ""}${r.note && !r.released ? ` (${r.note})` : ""}`);
    } catch (e) {
      console.error(`[agent] ${b.name}: execution error: ${(e as Error).message}`);
      results.push({ obligationId: b.obligationId, document: b.name, action: d.action, decisionHash: "0x" as Hex, note: `error: ${(e as Error).message}` });
    }
  }

  mkdirSync(join(dataDir, "runs"), { recursive: true });
  writeFileSync(
    join(dataDir, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ today, model: out.model, usage: out.usage, stopReason: out.stopReason, summary: out.summary, defaulted: out.defaulted, results }, null, 2),
  );
}

await runOnce();
if (!process.argv.includes("--once")) setInterval(runOnce, Number(env("AGENT_INTERVAL_MS", String(6 * 3600_000))));
