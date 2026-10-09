import type { Hex } from "viem";
import seeded from "./break-it.json";

/**
 * The /break-it scenarios. Each points at a demo obligation that scripts/seed-break-it.sh froze on-chain in a state
 * the contract must refuse. Pressing a button sends a real release() for it, so every press is a mined refusal.
 */
export type Scenario = {
  key: keyof typeof seeded.fixtures;
  title: string;
  attack: string;
  expect: string;
  why: string;
};

export const SCENARIOS: Scenario[] = [
  {
    key: "retry",
    title: "Retry a payment that already went through",
    attack: "A timeout makes the agent retry a bill that was already paid. This bill was paid once, for real.",
    expect: "AlreadySettled",
    why: "Each bill id comes from the ERP document, and the contract marks it settled before transferring. No retry, from any key, pays twice.",
  },
  {
    key: "swap",
    title: "“Our bank details have changed”",
    attack: "After the bill was approved, the supplier's wallet on file was swapped to 0x…bEEF. The agent asks to pay it.",
    expect: "PayeeMismatch",
    why: "The contract snapshots the payee wallet when a human approves the bill and pays only that wallet. The agent never supplies an address.",
  },
  {
    key: "phantom",
    title: "Pay money nobody saw arrive",
    attack: "The agent decided to pay, but no independent witness ever confirmed funding for this bill.",
    expect: "WitnessMissing",
    why: "Release needs an attestation from the witness key, which the agent does not hold and the contract forbids it from holding.",
  },
  {
    key: "short",
    title: "A $1.00 bill funded with $0.90",
    attack: "Circle's ledger and the chain show only $0.90 arrived for a $1.00 bill. The agent asks to pay the full amount.",
    expect: "WitnessMismatch",
    why: "The witness reports what it saw, not what was owed. The two halves have to match exactly.",
  },
  {
    key: "cosign",
    title: "$30 with no human signature",
    attack: "The bill is above the $25 co-sign threshold and no human has signed it.",
    expect: "NeedsCosign",
    why: "Above the threshold (or whenever the agent itself escalates), a separate COSIGNER key must sign. The agent cannot be that key.",
  },
  {
    key: "hold",
    title: "Release a bill the agent decided to hold",
    attack: "The agent's own committed decision for this bill is Hold. Something tries to release it anyway.",
    expect: "DecisionNotPay",
    why: "The decision hash is committed before money moves, and the release must match it. Here the decision is an input that stops the payment.",
  },
  {
    key: "ghost",
    title: "Pay a bill no human approved",
    attack: "The agent invents a bill id that was never registered from the books.",
    expect: "NotRegistered",
    why: "Only the APPROVER key, driven by ERPNext's approval workflow, can register a bill. The agent cannot create its own obligations.",
  },
];

export const FIXTURES = seeded.fixtures as Record<Scenario["key"], Hex>;
export const SEEDED = seeded;
