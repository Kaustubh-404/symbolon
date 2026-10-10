import { plainAction, ruleLabel } from "./rules";
import type { Address, Hex } from "viem";
import { decodeRefusal, type Refusal } from "@symbolon/sdk";
import { getEvents, type ChainEvent } from "./logs";
import { getRefusals, type MinedRefusal } from "./refusals";
import { blockTimestamps, dryRun, getObligations, type OnchainObligation } from "./reads";
import { attempt, EXPLORER_ERROR, fail, ok, RPC_ERROR, type Loaded } from "./loaded";
import { isZeroHash, usd, utc } from "./format";

export type ObligationRow = {
  id: Hex;
  payeeId: Hex;
  payee: Address;
  amount: bigint;
  notBefore: bigint;
  dueBy: bigint;
  docHash: Hex;
  registeredBlock: bigint;
  registeredTx: Hex;
  /** live getObligation(id) */
  onchain: Loaded<OnchainObligation>;
};

const lower = (h: unknown) => (typeof h === "string" ? h.toLowerCase() : "");

function registrations(events: ChainEvent[]) {
  const seen = new Map<string, ChainEvent>();
  for (const e of events) if (e.name === "ObligationRegistered" && !seen.has(lower(e.args.id))) seen.set(lower(e.args.id), e);
  return [...seen.values()];
}

function rowFrom(e: ChainEvent, onchain: Loaded<OnchainObligation>): ObligationRow {
  const a = e.args;
  return {
    id: a.id as Hex,
    payeeId: a.payeeId as Hex,
    payee: a.payee as Address,
    amount: a.amount as bigint,
    notBefore: a.notBefore as bigint,
    dueBy: a.dueBy as bigint,
    docHash: a.docHash as Hex,
    registeredBlock: e.blockNumber,
    registeredTx: e.txHash,
    onchain,
  };
}

export type ObligationList = { rows: ObligationRow[]; head: bigint };

/** All obligations from ObligationRegistered events, newest first by block, each with its live state. */
export async function listObligations(): Promise<Loaded<ObligationList>> {
  const ev = await attempt(getEvents);
  if (!ev.ok) return ev;
  const regs = registrations(ev.value.events);
  const states = await getObligations(regs.map((r) => r.args.id as Hex));
  const rows = regs.map((r, i) => rowFrom(r, states[i] ?? fail(RPC_ERROR))).reverse();
  return ok({ rows, head: ev.value.head });
}

export type TimelineTone = "neutral" | "released" | "refused" | "human";
export type TimelineItem = {
  key: string;
  title: string;
  who: string;
  lines: string[];
  tone: TimelineTone;
  blockNumber: bigint;
  order: number;
  txHash: Hex;
  timestamp: Loaded<bigint>;
};

export type ObligationDetail = {
  row: ObligationRow;
  timeline: TimelineItem[];
  refusalsSource: Loaded<true>;
  check: Loaded<{ data: Hex; refusal: Refusal | null }>;
  head: bigint;
};

function eventItem(e: ChainEvent): Omit<TimelineItem, "timestamp"> | null {
  const a = e.args;
  const base = { key: `${e.txHash}:${e.logIndex}`, blockNumber: e.blockNumber, order: e.logIndex, txHash: e.txHash };
  switch (e.name) {
    case "PayeeSet":
      return { ...base, title: "Supplier's wallet put on file", who: "a person (approver)", tone: "human", lines: [`wallet ${a.wallet as string}`, `can first be paid ${utc(a.cooldownEnds as bigint)} (new-wallet waiting period)`] };
    case "ObligationRegistered":
      return { ...base, title: "Bill approved and written on-chain", who: "a person (approver), via ERPNext", tone: "human", lines: [`${usd(a.amount as bigint)} to ${a.payee as string}`, `payable ${utc(a.notBefore as bigint)} → ${utc(a.dueBy as bigint)}`, `document fingerprint ${a.docHash as string}`] };
    case "WitnessAttested":
      return { ...base, title: "Money confirmed by the witness", who: "witness", tone: "neutral", lines: [`${usd(a.amount as bigint)} confirmed for this bill`, `funding transaction ${a.fundingRef as string}`, `evidence fingerprint ${a.witnessDigest as string}`] };
    case "DecisionCommitted":
      return { ...base, title: `AI decided: ${plainAction(Number(a.action))}`, who: "AI agent", tone: "neutral", lines: [`decision fingerprint ${a.decisionHash as string}`, "recorded before any money moves; payment only allowed in a later block"] };
    case "Cosigned":
      return { ...base, title: "Second signature added", who: "a person (co-signer)", tone: "human", lines: [`by ${a.cosigner as string}`] };
    case "Released":
      return { ...base, title: "Paid — the halves fit", who: "AI agent, checked by the contract", tone: "released", lines: [`${usd(a.amount as bigint)} paid to ${a.payee as string}`] };
    case "Cancelled":
      return { ...base, title: "Cancelled by a person", who: "a person (approver)", tone: "human", lines: ["the money set aside for it was freed"] };
    case "Expired":
      return { ...base, title: "Expired", who: "anyone", tone: "neutral", lines: ["its pay window closed; the money set aside for it was freed"] };
    default:
      return null;
  }
}

function refusalItem(r: MinedRefusal): Omit<TimelineItem, "timestamp"> {
  return {
    key: r.hash,
    blockNumber: r.blockNumber,
    order: Number.MAX_SAFE_INTEGER, // a reverted tx emits no logs; within its block, show it after the events
    txHash: r.hash,
    title: `Refused: ${ruleLabel(r.name)}`,
    who: r.method === "release" ? "payment attempt" : (r.method ?? "call"),
    tone: "refused",
    lines: [r.human],
  };
}

export async function getObligationDetail(id: Hex): Promise<Loaded<ObligationDetail | null>> {
  const ev = await attempt(getEvents);
  if (!ev.ok) return ev;
  const { events, head } = ev.value;
  const reg = registrations(events).find((e) => lower(e.args.id) === lower(id));
  if (!reg) return ok(null);

  const [onchain] = await getObligations([reg.args.id as Hex]);
  const row = rowFrom(reg, onchain ?? fail(RPC_ERROR));

  const mine = events.filter(
    (e) => lower(e.args.id) === lower(id) || (e.name === "PayeeSet" && lower(e.args.payeeId) === lower(row.payeeId)),
  );
  const items = mine.map(eventItem).filter((x): x is NonNullable<typeof x> => x !== null);

  const refusals = await attempt(getRefusals, EXPLORER_ERROR);
  if (refusals.ok) items.push(...refusals.value.refusals.filter((r) => lower(r.obligationId) === lower(id)).map(refusalItem));

  items.sort((a, b) => (a.blockNumber === b.blockNumber ? a.order - b.order : a.blockNumber < b.blockNumber ? -1 : 1));
  const times = await blockTimestamps(items.map((i) => i.blockNumber));
  const timeline = items.map((i) => {
    const t = times.get(i.blockNumber);
    return { ...i, timestamp: t === undefined ? fail<bigint>(RPC_ERROR) : ok(t) };
  });

  const raw = await dryRun(row.id);
  const check: ObligationDetail["check"] = raw.ok ? ok({ data: raw.value, refusal: decodeRefusal(raw.value) }) : raw;

  return ok({ row, timeline, refusalsSource: refusals.ok ? ok(true) : fail(EXPLORER_ERROR), check, head });
}

export const hasDecision = (o: OnchainObligation) => !isZeroHash(o.decisionHash);
export const hasWitness = (o: OnchainObligation) => !isZeroHash(o.witnessDigest);
