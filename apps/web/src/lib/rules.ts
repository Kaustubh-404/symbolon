/** Plain-language names for the contract's refusals (the jargon → plain map). The error name stays one click away. */
export const RULE: Record<string, string> = {
  AlreadySettled: "Already paid",
  PayeeMismatch: "Wallet isn't the one on the bill",
  PayeeChangedRecently: "New wallet, waiting period",
  WitnessMissing: "Money not confirmed",
  WitnessMismatch: "Confirmed amount ≠ bill",
  NeedsCosign: "Needs a second signature",
  DecisionNotPay: "AI decided not to pay",
  NotRegistered: "No approved bill",
  NoDecisionCommitted: "No decision on record",
  DecisionSameBlock: "Decision too fresh",
  TooEarly: "Too early to pay",
  PastDue: "Pay window closed",
  OverPeriodCap: "Over the daily limit",
  Paused: "Payments paused",
  NotAuthorized: "Wrong key for this action",
  RoleConflict: "One key, two roles",
  Unfunded: "Vault doesn't hold the money",
  RedeemExceedsSurplus: "More than the spare cash",
  AlreadyWitnessed: "Already confirmed",
  ConflictingRegistration: "Bill changed after approval",
  NoRevertData: "Refused without a named rule",
};

export const ruleLabel = (name: string) => RULE[name] ?? name;

/** Shorten raw 0x addresses and hashes inside a sentence for display ("0x676e9E…013b"). Display-only. */
export const shortenInText = (text: string) =>
  text
    .replace(/0x[0-9a-fA-F]{40,64}\b/g, (m) => `${m.slice(0, 8)}…${m.slice(-4)}`)
    .replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z/g, "$1 $2 UTC");

/** Bill status in plain words, with its state tone. */
export function plainStatus(status: number): { label: string; tone: "neutral" | "released" | "refused" | "wait" } {
  switch (status) {
    case 1:
      return { label: "Approved, unpaid", tone: "neutral" };
    case 2:
      return { label: "Paid", tone: "released" };
    case 3:
      return { label: "Cancelled", tone: "refused" };
    case 4:
      return { label: "Expired", tone: "refused" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

/** The AI's committed decision in plain words. */
export const plainAction = (action: number) => ["Not decided yet", "Pay", "Wait", "Ask a human"][action] ?? "Unknown";

/** Shorten one hash or address for display: "0x676e9E…013b". Server-safe (no client code). */
export function shortHash(value: string, keep = 6) {
  if (!value.startsWith("0x") || value.length <= keep * 2 + 4) return value;
  return `${value.slice(0, keep + 2)}…${value.slice(-4)}`;
}
