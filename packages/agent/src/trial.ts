import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createWalletClient, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CircleMint, FileJournal, NonceSafeSender, arcTransport, chainFor, explorerTx } from "@symbolon/sdk";
import { ErpNextBooks } from "./books.js";
import { chainReader } from "./chain.js";
import { decide, MODEL } from "./decide.js";
import { execute } from "./execute.js";
import { SYSTEM_PROMPT } from "./prompt.js";

/**
 * "Try it yourself": a judge submits a bill from the website and watches it go through the real pipeline.
 *
 *   POST /trials {amountUsd, note}  → creates + submits a Purchase Invoice in our ERPNext (as an accountant would)
 *   GET  /trials/:id               → live stages: registered → decided → funded → witnessed → paid | refused
 *
 * The bill is payable to our test vendor (TEST-VENDOR-01), whose wallet has been on file for days: a brand-new wallet
 * would sit in the contract's 24 h payee cooldown, which is the anti-fraud rule itself. The note goes into the invoice
 * remarks, where the agent reads it as untrusted counterparty text — so judges can try a prompt injection.
 * One trial runs at a time, so the nonce-safe senders never race.
 */

type Stage = { at: string; stage: string; detail: string; tx?: string; txUrl?: string };
type Trial = { id: string; invoice: string; amountUsd: string; note: string; createdAt: string; done: boolean; outcome?: string; stages: Stage[] };

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const chainId = Number(env("CHAIN_ID", "5042002"));
const dataDir = env("AGENT_DATA_DIR", ".data/agent");
const trialsPath = join(dataDir, "trials.json");
mkdirSync(dataDir, { recursive: true });
const trials: Record<string, Trial> = existsSync(trialsPath) ? JSON.parse(readFileSync(trialsPath, "utf8")) : {};
const save = () => writeFileSync(trialsPath, JSON.stringify(trials, null, 2));

const chain = chainReader(chainId);
const mk = (pk: string, journal: string) =>
  new NonceSafeSender(
    chain.pub,
    createWalletClient({ chain: chainFor(chainId), account: privateKeyToAccount(pk as Hex), transport: arcTransport(chainId) }),
    new FileJournal(join(dataDir, journal)),
  );
const sender = mk(env("AGENT_PK"), "journal.json");
const treasurySender = mk(env("TREASURY_PK"), "treasury-journal.json");
const mint = new CircleMint(env("CIRCLE_MINT_KEY"));
const erpUrl = env("ERPNEXT_URL");
const erpToken = env("ERPNEXT_TOKEN");
const books = new ErpNextBooks(erpUrl, erpToken);
const client = new Anthropic();
const VENDOR = env("TRIAL_SUPPLIER", "TEST-VENDOR-01");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
function stage(t: Trial, s: string, detail: string, tx?: string) {
  t.stages.push({ at: now(), stage: s, detail, tx, txUrl: tx ? explorerTx(chainId, tx) : undefined });
  save();
}

async function erp<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${erpUrl}${path}`, {
    method,
    headers: { Authorization: `token ${erpToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await r.json()) as { data?: T; message?: T; exception?: string };
  if (!r.ok) throw new Error(`ERPNext ${path} → ${r.status} ${j.exception ?? ""}`.slice(0, 300));
  return (j.data ?? j.message) as T;
}

async function createInvoice(amountUsd: string, note: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const draft = await erp<{ name: string }>("POST", "/api/resource/Purchase%20Invoice", {
    supplier: VENDOR,
    posting_date: today,
    set_posting_time: 1,
    due_date: due,
    bill_no: `TRY-${Date.now().toString(36).toUpperCase()}`,
    currency: "USD",
    remarks: note || "Submitted from the Symbolon website (judge trial).",
    items: [{ item_code: "Contract Work", qty: 1, rate: Number(amountUsd) }],
  });
  const doc = await erp<Record<string, unknown>>("GET", `/api/resource/Purchase%20Invoice/${encodeURIComponent(draft.name)}`);
  await erp("POST", "/api/method/frappe.client.submit", { doc });
  return draft.name;
}

async function run(t: Trial) {
  try {
    t.invoice = await createInvoice(t.amountUsd, t.note);
    stage(t, "approved", `Purchase Invoice ${t.invoice} for $${t.amountUsd} created and submitted in ERPNext, due tomorrow.`);

    // 1. ERPNext's own on-submit hook registers the bill on-chain with the APPROVER key.
    let reg: { symbolon_status: string; symbolon_register_tx: string | null } | null = null;
    for (let i = 0; i < 40; i++) {
      reg = await erp("GET", `/api/resource/Purchase%20Invoice/${encodeURIComponent(t.invoice)}`);
      if (reg?.symbolon_register_tx) break;
      await sleep(3_000);
    }
    if (!reg?.symbolon_register_tx) throw new Error("ERPNext did not register the bill on-chain within 2 minutes");
    stage(t, "registered", "ERPNext registered the bill on Arc (human-approved document hash, payee, amount, window).", reg.symbolon_register_tx);

    // 2. The agent decides, for this bill only.
    const bill = (await books.openBills()).find((b) => b.name === t.invoice);
    if (!bill) throw new Error("bill not found among open bills");
    const today = new Date().toISOString().slice(0, 10);
    const out = await decide(client, { today, bills: [bill], chain, mint, annualYieldPct: 4.5 });
    const d = out.decisions.get(bill.obligationId)!;
    stage(t, "decided", `${d.action.toUpperCase()}: ${d.rationale}${d.concerns.length ? ` Concerns: ${d.concerns.join("; ")}` : ""}`);

    // 3. Execute through the contract: commit → fund (Mint → treasury → vault) → witness → release.
    const r = await execute(
      {
        chainId,
        chain,
        sender,
        mint,
        treasuryRecipientId: env("MINT_TREASURY_RECIPIENT_ID"),
        treasurySender,
        wire: process.env.MINT_WIRE_TRACKING_REF
          ? { trackingRef: env("MINT_WIRE_TRACKING_REF"), beneficiaryAccountNumber: env("MINT_WIRE_BENEFICIARY_ACCOUNT") }
          : null,
        claimsDir: env("CLAIMS_DIR", ".data/claims"),
        decisionsDir: join(dataDir, "decisions"),
        today,
        model: out.model,
        promptHash: keccak256(toBytes(SYSTEM_PROMPT)),
        witnessTimeoutMs: 180_000,
      },
      bill,
      d,
    );
    if (r.commitTx) stage(t, "committed", `Decision hash ${r.decisionHash.slice(0, 18)}… committed on-chain before any money moved.`, r.commitTx);
    if (r.fundingTransferId) stage(t, "funded", `Circle Mint transfer ${r.fundingTransferId} funded the treasury, which forwarded exactly $${t.amountUsd} into the vault.`);
    const o = await chain.obligation(bill.obligationId);
    if (o.witnessDigest !== `0x${"0".repeat(64)}`) stage(t, "witnessed", "The independent witness checked Circle's record and both on-chain hops, and attested.");
    if (r.released) {
      stage(t, "paid", `The contract checked every rule and paid the vendor $${t.amountUsd}. ERPNext books the payment within a minute.`, r.released);
      t.outcome = "paid";
    } else if (r.refusal) {
      stage(t, "refused", `${r.refusal.name}: ${r.refusal.human}`);
      t.outcome = "refused";
    } else {
      stage(t, d.action === "escalate" ? "escalated" : "held", d.action === "escalate" ? "The agent escalated this bill to a human. Nothing was paid." : r.note ?? "The agent decided not to pay now.");
      t.outcome = d.action;
    }
  } catch (e) {
    stage(t, "error", (e as Error).message);
    t.outcome = "error";
  } finally {
    t.done = true;
    save();
  }
}

// One trial at a time; limits keep a public endpoint from draining test funds.
const queue: Trial[] = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) await run(queue.shift()!);
  running = false;
}
const today = () => new Date().toISOString().slice(0, 10);
const todaysCount = () => Object.values(trials).filter((t) => t.createdAt.startsWith(today())).length;
const MAX_PER_DAY = Number(env("TRIALS_PER_DAY", "40"));

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 4_000) throw new Error("body too large");
  }
  return s ? (JSON.parse(s) as Record<string, unknown>) : {};
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname === "/trials") {
      if (process.env.TRIAL_TOKEN && req.headers["x-trial-token"] !== process.env.TRIAL_TOKEN) return json(res, 401, { error: "unauthorized" });
      if (todaysCount() >= MAX_PER_DAY) return json(res, 429, { error: "today's trial limit is reached; the refusals on /break-it still work" });
      if (queue.length >= 5) return json(res, 429, { error: "a few trials are already queued; try again in a minute" });
      const b = await readBody(req);
      const amount = Number(b.amountUsd);
      if (!Number.isFinite(amount) || amount < 0.1 || amount > 2) return json(res, 400, { error: "amount must be between $0.10 and $2.00" });
      const note = String(b.note ?? "").slice(0, 500);
      const id = `try-${Date.now().toString(36)}`;
      const t: Trial = { id, invoice: "", amountUsd: amount.toFixed(2), note, createdAt: now(), done: false, stages: [] };
      trials[id] = t;
      save();
      queue.push(t);
      void pump();
      return json(res, 202, { id, position: queue.length });
    }
    const m = /^\/trials\/(try-[a-z0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const t = trials[m[1]!];
      return t ? json(res, 200, { ...t, queued: queue.indexOf(t) + 1 || 0 }) : json(res, 404, { error: "no such trial" });
    }
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, model: MODEL, running, queued: queue.length });
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
}).listen(Number(env("TRIAL_PORT", "8787")), "127.0.0.1", () => console.log(`[trial] listening on 127.0.0.1:${env("TRIAL_PORT", "8787")}`));
