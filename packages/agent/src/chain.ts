import { createPublicClient, type Hex } from "viem";
import { arcTransport, chainFor, decodeRefusal, deployments, symbolonAbi, unitsToUsd, USDC_ADDRESS, type Refusal } from "@symbolon/sdk";

const erc20BalanceOf = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const STATUS = ["none", "registered", "released", "cancelled", "expired"] as const;
export const ACTION = ["none", "pay", "hold", "escalate"] as const;

export function chainReader(chainId: number) {
  const dep = deployments[String(chainId) as keyof typeof deployments];
  if (!dep) throw new Error(`no deployment for chain ${chainId}`);
  const vault = dep.symbolon as Hex;
  const pub = createPublicClient({ chain: chainFor(chainId), transport: arcTransport(chainId) });

  const read = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: vault, abi: symbolonAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  return {
    pub,
    vault,
    dep,
    async obligation(id: Hex) {
      const o = await read<{
        docHash: Hex; payeeId: Hex; payee: Hex; amount: bigint; notBefore: bigint; dueBy: bigint; status: number;
        action: number; decidedBlock: bigint; decisionHash: Hex; witnessDigest: Hex; fundingRef: Hex; witnessedAmount: bigint; cosigned: boolean;
      }>("getObligation", [id]);
      return o;
    },
    async check(id: Hex): Promise<Refusal | null> {
      return decodeRefusal(await read<Hex>("check", [id]));
    },
    async payee(id: Hex) {
      const [wallet, changedAt] = await read<[Hex, bigint]>("payees", [id]);
      return { wallet, changedAt: Number(changedAt) };
    },
    async treasury() {
      const [bal, reserved, period, cap, threshold, cooldown] = await Promise.all([
        pub.readContract({ address: USDC_ADDRESS, abi: erc20BalanceOf, functionName: "balanceOf", args: [vault] }),
        read<bigint>("reserved"),
        read<bigint>("currentPeriod"),
        read<bigint>("periodCap"),
        read<bigint>("cosignThreshold"),
        read<bigint>("payeeCooldown"),
      ]);
      const spent = await read<bigint>("spentInPeriod", [period]);
      return {
        vaultBalanceUsd: unitsToUsd(bal),
        reservedUsd: unitsToUsd(reserved),
        spentTodayUsd: unitsToUsd(spent),
        dailyCapUsd: unitsToUsd(cap),
        cosignThresholdUsd: unitsToUsd(threshold),
        payeeCooldownHours: Number(cooldown) / 3600,
      };
    },
  };
}

export type ChainReader = ReturnType<typeof chainReader>;
