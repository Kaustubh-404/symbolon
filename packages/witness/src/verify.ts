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

/** USDC Transfer events in a receipt (ERC-20 view only; EIP-7708 system-emitter logs are ignored). */
function usdcTransfers(chain: ChainEvidence) {
  return chain.logs
    .filter((l) => l.address.toLowerCase() === USDC_ADDRESS.toLowerCase())
    .filter((l) => l.address.toLowerCase() !== SYSTEM_EMITTER)
    .map((l) => {
      try {
        return decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      } catch {
        return null;
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

const sumTo = (chain: ChainEvidence, to: Hex, from?: Hex) =>
  usdcTransfers(chain)
    .filter((e) => getAddress(e.args.to) === getAddress(to) && (!from || getAddress(e.args.from) === getAddress(from)))
    .reduce((s, e) => s + e.args.value, 0n);

/**
 * Funding arrives one of two ways:
 *  - direct: Circle Mint → vault (one hop). Measured 2026-10-09: the Mint sandbox fails transfers on ARC to a contract
 *    address ("blockchain_error"), so in practice this is the path for EOA vaults only.
 *  - via treasury: Circle Mint → treasury EOA (hop 1), then treasury → vault for the same amount (hop 2).
 * The witness checks every hop against the chain, and hop 1 against Circle's own record.
 */
export function verifyFunding(args: {
  obligation: OpenObligation;
  vault: Hex;
  transfer: MintTransfer;
  transferRaw: string;
  chain: ChainEvidence | null;
  /** Circle transfer ids already used to witness other obligations → that obligation id */
  used: ReadonlyMap<string, Hex>;
  /** the treasury EOA that receives Mint transfers, when funding goes via treasury */
  treasury?: Hex;
  /** hop 2 receipt (treasury → vault), required when the Circle transfer went to the treasury */
  forward?: ChainEvidence | null;
  /** forward tx hashes already used to witness other obligations → that obligation id */
  usedForwards?: ReadonlyMap<string, Hex>;
}): Verdict {
  const { obligation: o, vault, transfer: t, transferRaw, chain, used, treasury, forward, usedForwards } = args;

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
  const dest = t.destination.address ? getAddress(t.destination.address) : null;
  const viaTreasury = !!treasury && dest === getAddress(treasury);
  if (!dest || (dest !== getAddress(vault) && !viaTreasury)) {
    return { attest: false, reason: `Circle transfer ${t.id} was sent to ${t.destination.address}, not the vault or treasury`, retryable: false };
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
  const hop1 = sumTo(chain, dest);
  if (hop1 === 0n) return { attest: false, reason: `tx ${chain.txHash} moved no USDC to ${dest}`, retryable: false };
  if (hop1 !== circleAmount) {
    return { attest: false, reason: `Circle says ${circleAmount} units, the chain shows ${hop1} — ledgers disagree`, retryable: false };
  }

  let fundingRef = chain.txHash;
  if (viaTreasury) {
    if (!forward) return { attest: false, reason: "funding reached the treasury; waiting for the forward into the vault", retryable: true };
    const fprior = usedForwards?.get(forward.txHash.toLowerCase());
    if (fprior && fprior !== o.id) return { attest: false, reason: `forward tx already witnessed obligation ${fprior}`, retryable: false };
    if (forward.status !== "success") return { attest: false, reason: `forward tx ${forward.txHash} reverted`, retryable: false };
    if (forward.blockNumber < chain.blockNumber) {
      return { attest: false, reason: "forward into the vault happened before Circle's funding arrived", retryable: false };
    }
    const hop2 = sumTo(forward, vault, treasury);
    if (hop2 !== circleAmount) {
      return {
        attest: false,
        reason: `treasury forwarded ${hop2} units into the vault, but Circle funded ${circleAmount} — the hops disagree`,
        retryable: false,
      };
    }
    fundingRef = forward.txHash;
  }

  return {
    attest: true,
    observedAmount: circleAmount,
    fundingRef,
    witnessDigest: digestEvidence(transferRaw),
    mismatch: circleAmount !== o.amount,
    chainFrom: usdcTransfers(chain).find((e) => getAddress(e.args.to) === dest)!.args.from,
  };
}
