import type { Hex } from "viem";
import { hashRecord } from "./ids.js";

/** The agent's decision about one obligation. Its keccak (over canonical JSON) is committed on-chain before release. */
export type DecisionRecord = {
  schema: "symbolon.decision/v1";
  obligationId: Hex;
  action: "pay" | "hold" | "escalate";
  /** when the agent intends to pay, ISO date; null for hold/escalate */
  payDate: string | null;
  fundingSource: "float" | "mint_issue" | "gateway_pull" | "usyc_redeem" | "none";
  /** early-payment discount captured by paying now, in USDC base units (6 dp), as a decimal string */
  discountCaptured: string;
  rationale: string;
  alternatives: { action: string; why_not: string }[];
  /** what the agent saw, by hash, so the decision can be re-derived */
  inputs: { calendarHash: Hex; balancesHash: Hex; documentHash: Hex };
  model: string;
  promptHash: Hex;
  decidedAt: string;
};

export const ACTION_CODE = { pay: 1, hold: 2, escalate: 3 } as const;

export function decisionHash(d: DecisionRecord): Hex {
  return hashRecord(d);
}
