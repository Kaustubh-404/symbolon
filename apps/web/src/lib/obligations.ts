import type { Address, Hex } from "viem";
import { decodeRefusal, type Refusal } from "@symbolon/sdk";
import { getEvents, type ChainEvent } from "./logs";
import { getRefusals, type MinedRefusal } from "./refusals";
import { blockTimestamps, dryRun, getObligations, type OnchainObligation } from "./reads";
import { attempt, EXPLORER_ERROR, fail, ok, RPC_ERROR, type Loaded } from "./loaded";
import { actionName, isZeroHash, usdc, utc } from "./format";

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
      return { ...base, title: "Payee wallet set", who: "approver", tone: "human", lines: [`wallet ${a.wallet as string}`, `cooldown ends ${utc(a.cooldownEnds as bigint)}`] };
    case "ObligationRegistered":
      return { ...base, title: "Bill registered — the document half", who: "approver", tone: "human", lines: [`${usdc(a.amount as bigint)} USDC to ${a.payee as string}`, `window ${utc(a.notBefore as bigint)} → ${utc(a.dueBy as bigint)}`, `docHash ${a.docHash as string}`] };
    case "WitnessAttested":
      return { ...base, title: "Funding witnessed — the witness half", who: "witness", tone: "neutral", lines: [`${usdc(a.amount as bigint)} USDC reserved`, `fundingRef ${a.fundingRef as string}`, `witnessDigest ${a.witnessDigest as string}`] };
    case "DecisionCommitted":
      return { ...base, title: `Decision committed: ${actionName(Number(a.action))}`, who: "agent", tone: "neutral", lines: [`decisionHash ${a.decisionHash as string}`, "release is allowed only in a later block"] };
    case "Cosigned":
      return { ...base, title: "Co-signed", who: "cosigner", tone: "human", lines: [`by ${a.cosigner as string}`] };
    case "Released":
      return { ...base, title: "Released — the halves fit", who: "agent", tone: "released", lines: [`${usdc(a.amount as bigint)} USDC paid to ${a.payee as string}`] };
    case "Cancelled":
      return { ...base, title: "Cancelled", who: "approver", tone: "human", lines: ["reservation freed"] };
    case "Expired":
      return { ...base, title: "Expired", who: "anyone", tone: "neutral", lines: ["past dueBy + grace; reservation freed"] };
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
    title: `Refused on-chain: ${r.name}`,
    who: r.method ?? "call",
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
