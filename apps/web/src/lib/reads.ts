import { erc20Abi, keccak256, toBytes, type Address, type Hex } from "viem";
import { symbolonAbi } from "@symbolon/sdk";
import { client } from "./client";
import { DEPLOYMENT, MULTICALL3, SNAPSHOT_TTL_MS, SYMBOLON, USDC } from "./config";
import { attempt, fail, ok, RPC_ERROR, type Loaded } from "./loaded";
import { memo } from "./memo";

/** One multicall; each slot is its own Loaded so one failing view never zeroes the others. */
async function multi<T extends readonly unknown[]>(contracts: { [K in keyof T]: unknown }): Promise<{ [K in keyof T]: Loaded<T[K]> }> {
  const res = await attempt(() =>
    client.multicall({ contracts: contracts as never, allowFailure: true, multicallAddress: MULTICALL3 }),
  );
  return contracts.map((_, i) => {
    if (!res.ok) return fail(RPC_ERROR);
    const r = (res.value as Array<{ status: string; result?: unknown }>)[i];
    return r && r.status === "success" ? ok(r.result) : fail(RPC_ERROR);
  }) as never;
}

const S = { address: SYMBOLON, abi: symbolonAbi } as const;

export type VaultState = {
  releasedCount: Loaded<bigint>;
  totalReleased: Loaded<bigint>;
  reserved: Loaded<bigint>;
  surplus: Loaded<bigint>;
  vaultBalance: Loaded<bigint>;
};

export function getVaultState(): Promise<VaultState> {
  return memo("vault", SNAPSHOT_TTL_MS, async () => {
    const [releasedCount, totalReleased, reserved, surplus, vaultBalance] = await multi<
      [bigint, bigint, bigint, bigint, bigint]
    >([
      { ...S, functionName: "releasedCount" },
      { ...S, functionName: "totalReleased" },
      { ...S, functionName: "reserved" },
      { ...S, functionName: "surplus" },
      // USDC through its ERC-20 view (6 decimals). Never eth_getBalance, which is the 18-decimal native view.
      { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [SYMBOLON] },
    ]);
    return { releasedCount, totalReleased, reserved, surplus, vaultBalance };
  });
}

export const ROLES = ["ADMIN", "APPROVER", "AGENT", "WITNESS", "COSIGNER", "GUARDIAN"] as const;
export type RoleName = (typeof ROLES)[number];
export const roleHash = (r: RoleName): Hex => keccak256(toBytes(r));

export const ROLE_HOLDERS: Array<{ role: RoleName; address: Address; duty: string }> = [
  { role: "ADMIN", address: DEPLOYMENT.admin, duty: "Sets parameters and grants roles. Cannot be the agent." },
  { role: "APPROVER", address: DEPLOYMENT.approver, duty: "A human, through ERPNext's approval flow: sets payees and registers approved bills (the document half)." },
  { role: "AGENT", address: DEPLOYMENT.agent, duty: "The model's signer: commits decisions and calls release. Holds no other role." },
  { role: "WITNESS", address: DEPLOYMENT.witness, duty: "A separate service that reads Circle Mint's ledger and attests funding (the witness half)." },
  { role: "COSIGNER", address: DEPLOYMENT.cosigner, duty: "A human co-signature above the threshold, or whenever the agent escalates." },
  { role: "GUARDIAN", address: DEPLOYMENT.guardian, duty: "May pause payments. May not move funds or unpause." },
];

export type Params = {
  cosignThreshold: Loaded<bigint>;
  periodCap: Loaded<bigint>;
  periodLength: Loaded<bigint>;
  payeeCooldown: Loaded<bigint>;
  grace: Loaded<bigint>;
  paused: Loaded<boolean>;
  mintDeposit: Loaded<Address>;
  currentPeriod: Loaded<bigint>;
  spentInPeriod: Loaded<bigint>;
  /** live hasRole(role, holder) for every listed holder × every role */
  roleMatrix: Record<string, Partial<Record<RoleName, Loaded<boolean>>>>;
};

export function getParams(): Promise<Params> {
  return memo("params", SNAPSHOT_TTL_MS, async () => {
    const [cosignThreshold, periodCap, periodLength, payeeCooldown, grace, paused, mintDeposit, currentPeriod] =
      await multi<[bigint, bigint, bigint, bigint, bigint, boolean, Address, bigint]>([
        { ...S, functionName: "cosignThreshold" },
        { ...S, functionName: "periodCap" },
        { ...S, functionName: "periodLength" },
        { ...S, functionName: "payeeCooldown" },
        { ...S, functionName: "grace" },
        { ...S, functionName: "paused" },
        { ...S, functionName: "mintDeposit" },
        { ...S, functionName: "currentPeriod" },
      ]);

    const spentInPeriod: Loaded<bigint> = currentPeriod.ok
      ? (await multi<[bigint]>([{ ...S, functionName: "spentInPeriod", args: [currentPeriod.value] }]))[0]
      : fail(RPC_ERROR);

    const pairs = ROLE_HOLDERS.flatMap((h) => ROLES.map((role) => ({ holder: h.address, role })));
    const flags = await multi<boolean[]>(
      pairs.map((p) => ({ ...S, functionName: "hasRole", args: [roleHash(p.role), p.holder] })),
    );
    const roleMatrix: Params["roleMatrix"] = {};
    pairs.forEach((p, i) => {
      (roleMatrix[p.holder] ??= {})[p.role] = flags[i] ?? fail(RPC_ERROR);
    });

    return { cosignThreshold, periodCap, periodLength, payeeCooldown, grace, paused, mintDeposit, currentPeriod, spentInPeriod, roleMatrix };
  });
}

export type OnchainObligation = {
  docHash: Hex;
  payeeId: Hex;
  payee: Address;
  amount: bigint;
  notBefore: bigint;
  dueBy: bigint;
  status: number;
  action: number;
  decidedBlock: bigint;
  decisionHash: Hex;
  witnessDigest: Hex;
  fundingRef: Hex;
  witnessedAmount: bigint;
  cosigned: boolean;
};

/** getObligation for many ids in one multicall. */
export async function getObligations(ids: Hex[]): Promise<Array<Loaded<OnchainObligation>>> {
  if (ids.length === 0) return [];
  return multi<OnchainObligation[]>(ids.map((id) => ({ ...S, functionName: "getObligation", args: [id] })));
}

/** check(id): the exact revert data release(id) would produce at the latest block, or 0x. */
export function dryRun(id: Hex): Promise<Loaded<Hex>> {
  return attempt(() => client.readContract({ ...S, functionName: "check", args: [id] }));
}

const blockTimes = new Map<bigint, bigint>();
/** Block timestamps never change once mined, so they are cached for the life of the process. */
export async function blockTimestamps(blocks: bigint[]): Promise<Map<bigint, bigint>> {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b));
  await Promise.all(
    missing.map(async (b) => {
      const r = await attempt(() => client.getBlock({ blockNumber: b }));
      if (r.ok) blockTimes.set(b, r.value.timestamp);
    }),
  );
  return blockTimes;
}
