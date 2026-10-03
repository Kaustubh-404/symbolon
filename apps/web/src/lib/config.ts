import type { Address } from "viem";
import { deployments, explorerAddress } from "@symbolon/sdk";

export const CHAIN_ID = 5042002 as const;
export const DEPLOYMENT = deployments["5042002"];
export const SYMBOLON = DEPLOYMENT.symbolon as Address;
export const USDC = DEPLOYMENT.usdc as Address;
export const DEPLOY_BLOCK = BigInt(DEPLOYMENT.deployBlock);

/** Multicall3 at its canonical address (checked on Arc Testnet: code present). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const EXPLORER_API = "https://explorer.testnet.arc.io/api/v2";
export const GITHUB_URL = "https://github.com/Kaustubh-404/symbolon";
export const CONTRACT_URL = explorerAddress(CHAIN_ID, SYMBOLON);
export const SOURCE_URL = `${CONTRACT_URL}?tab=contract`;

/** How long a chain snapshot is reused before it is read again. Keeps judges from hammering public RPCs. */
export const SNAPSHOT_TTL_MS = 15_000;
