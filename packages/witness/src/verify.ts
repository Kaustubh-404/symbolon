import { decodeEventLog, erc20Abi, getAddress, type Hex } from "viem";
import { USDC_ADDRESS, SYSTEM_EMITTER, digestEvidence, usdToUnits, type MintTransfer } from "@symbolon/sdk";

/**
 * The witness's whole judgement, as a pure function.
 *
 * It answers one question: "did the money for THIS bill really arrive in the vault, according to a ledger
 * the agent does not write (Circle Mint) AND to the chain?" Two rules shape the answers:
 *
 *  - It reports what it SAW. If Circle sent $4,900 for a $5,000 bill, the witness attests $4,900 and the
 *    contract refuses the release with WitnessMismatch — a loud, on-chain refusal, not a silent skip.
 *  - It refuses to attest only when it cannot confirm that anything happened: no Circle record, not yet
 *    on-chain, the chain disagrees with Circle, or the same Circle transfer is being claimed twice.
 */

export type OpenObligation = {
  id: Hex;
  amount: bigint; // USDC 6dp
  status: number; // Symbolon.Status: 1 = Registered
  witnessDigest: Hex;
};

export type ChainEvidence = {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs: { address: Hex; topics: readonly Hex[]; data: Hex }[];
};

export type Verdict =
  | {
      attest: true;
      observedAmount: bigint;
      fundingRef: Hex;
      witnessDigest: Hex;
      mismatch: boolean;
      chainFrom: Hex;
    }
  | { attest: false; reason: string; retryable: boolean };

const ZERO32 = `0x${"0".repeat(64)}` as Hex;

export function verifyFunding(args: {
  obligation: OpenObligation;
  vault: Hex;
  transfer: MintTransfer;
  transferRaw: string;
  chain: ChainEvidence | null;
  /** Circle transfer ids already used to witness other obligations → that obligation id */
  used: ReadonlyMap<string, Hex>;
}): Verdict {
  const { obligation: o, vault, transfer: t, transferRaw, chain, used } = args;

  if (o.status !== 1) return { attest: false, reason: `obligation is not open (status ${o.status})`, retryable: false };
  if (o.witnessDigest !== ZERO32) return { attest: false, reason: "obligation already witnessed", retryable: false };

  const prior = used.get(t.id);
  if (prior && prior !== o.id) {
    return { attest: false, reason: `Circle transfer ${t.id} already witnessed obligation ${prior}`, retryable: false };
  }
  if (t.status === "failed") return { attest: false, reason: `Circle transfer ${t.id} failed`, retryable: false };
  if (t.destination.type !== "blockchain" || t.destination.chain !== "ARC") {
    return { attest: false, reason: `Circle transfer ${t.id} is not an on-chain transfer on ARC`, retryable: false };
  }
  if (!t.destination.address || getAddress(t.destination.address) !== getAddress(vault)) {
    return { attest: false, reason: `Circle transfer ${t.id} was sent to ${t.destination.address}, not the vault`, retryable: false };
  }
  if (t.amount.currency !== "USD") return { attest: false, reason: `unsupported currency ${t.amount.currency}`, retryable: false };

  // Circle's status lags the chain (measured): accept pending/running as long as a tx hash exists and the chain agrees.
  if (!t.transactionHash) return { attest: false, reason: `Circle transfer ${t.id} has no on-chain hash yet`, retryable: true };
  if (!chain) return { attest: false, reason: `tx ${t.transactionHash} not found on Arc yet`, retryable: true };
  if (chain.txHash.toLowerCase() !== t.transactionHash.toLowerCase()) {
    return { attest: false, reason: "chain evidence is for a different tx than Circle reports", retryable: false };
  }
  if (chain.status !== "success") return { attest: false, reason: `tx ${chain.txHash} reverted on-chain`, retryable: false };

  const circleAmount = usdToUnits(t.amount.amount);
  const toVault = chain.logs
    .filter((l) => l.address.toLowerCase() === USDC_ADDRESS.toLowerCase()) // the ERC-20 view; never the EIP-7708 system emitter
    .filter((l) => l.address.toLowerCase() !== SYSTEM_EMITTER)
    .map((l) => {
      try {
        return decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      } catch {
        return null;
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .filter((e) => getAddress(e.args.to) === getAddress(vault));

  const onChain = toVault.reduce((s, e) => s + e.args.value, 0n);
  if (onChain === 0n) return { attest: false, reason: `tx ${chain.txHash} moved no USDC into the vault`, retryable: false };
  if (onChain !== circleAmount) {
    return {
      attest: false,
      reason: `Circle says ${circleAmount} units, the chain shows ${onChain} into the vault — ledgers disagree`,
      retryable: false,
    };
  }

  return {
    attest: true,
    observedAmount: circleAmount,
    fundingRef: chain.txHash,
    witnessDigest: digestEvidence(transferRaw),
    mismatch: circleAmount !== o.amount,
    chainFrom: toVault[0]!.args.from,
  };
}
