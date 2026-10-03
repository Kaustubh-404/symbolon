import { decodeErrorResult, formatUnits, type Hex } from "viem";
import { symbolonAbi } from "./generated/abi.js";
import { USDC_DECIMALS } from "./chains.js";

export type Refusal = {
  /** custom error name, e.g. "PayeeChangedRecently" */
  name: string;
  args: readonly unknown[];
  /** one sentence a non-crypto reader understands */
  human: string;
};

const usd = (v: unknown) => `$${formatUnits(BigInt(v as bigint), USDC_DECIMALS)}`;
const when = (v: unknown) => new Date(Number(v) * 1000).toISOString().replace(".000Z", "Z");
const STATUS = ["none", "registered", "released", "cancelled", "expired"];
const ACTION = ["none", "pay", "hold", "escalate"];

const HUMAN: Record<string, (a: readonly unknown[]) => string> = {
  NotRegistered: () => "No approved bill with this id exists. The agent cannot pay what a human did not approve.",
  AlreadySettled: (a) => `This bill is already ${STATUS[Number(a[1])] ?? "settled"}. A retry cannot pay it twice.`,
  NoDecisionCommitted: () => "The agent has not committed a decision for this bill yet.",
  DecisionNotPay: (a) => `The agent's committed decision is "${ACTION[Number(a[1])]}", not "pay".`,
  DecisionSameBlock: () => "The decision must be committed at least one block before the payment.",
  WitnessMissing: () => "No independent witness has confirmed the money for this bill arrived.",
  WitnessMismatch: (a) => `The witness saw ${usd(a[1])} arrive, but the bill is for ${usd(a[2])}.`,
  AlreadyWitnessed: () => "This bill already has a witness attestation.",
  Unfunded: (a) => `The vault holds ${usd(a[0])}; reserving this bill would need ${usd(a[1])}.`,
  TooEarly: (a) => `This bill may not be paid before ${when(a[1])}.`,
  PastDue: (a) => `The window to pay this bill closed at ${when(a[1])}.`,
  NotYetExpirable: (a) => `This bill can only be expired after ${when(a[1])}.`,
  PayeeMismatch: (a) => `The payee's wallet changed after the bill was approved (${a[1]} → ${a[2]}).`,
  PayeeChangedRecently: (a) => `This payee's wallet was changed recently. Payments resume at ${when(a[1])}, giving a human time to notice.`,
  NeedsCosign: (a) => `Bills above ${usd(a[2])}, or ones the agent escalates, need a human co-signature (this one is ${usd(a[1])}).`,
  OverPeriodCap: (a) => `Paying this would bring today's total to ${usd(a[0])}, over the ${usd(a[1])} cap.`,
  RedeemExceedsSurplus: (a) => `Only ${usd(a[1])} is unreserved; the agent tried to redeem ${usd(a[0])}.`,
  ConflictingRegistration: () => "A bill with this id is already registered with different terms.",
  NotAuthorized: (a) => `${a[1]} does not hold the role this action needs.`,
  RoleConflict: (a) => `${a[2]} already holds a conflicting role. The agent can never also approve, witness or cosign.`,
  Paused: () => "A guardian has paused all payments.",
  ZeroAmount: () => "Amount must be greater than zero.",
  InvalidWindow: () => "The pay window ends before it starts.",
  UnknownPayee: () => "This payee has no wallet on file.",
  ZeroAddress: () => "Address must not be zero.",
  TransferFailed: () => "The USDC transfer failed.",
};

/** Decode revert data from `release`, `check` or any Symbolon call into a named, human-readable refusal. */
export function decodeRefusal(data: Hex): Refusal | null {
  if (!data || data === "0x") return null;
  try {
    const r = decodeErrorResult({ abi: symbolonAbi, data });
    const args = (r.args ?? []) as readonly unknown[];
    return { name: r.errorName, args, human: HUMAN[r.errorName]?.(args) ?? r.errorName };
  } catch {
    return { name: "Unknown", args: [data], human: `Unrecognised revert data ${data.slice(0, 10)}` };
  }
}
