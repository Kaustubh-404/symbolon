import { defineChain, fallback, http, type Transport } from "viem";

/**
 * Arc networks. USDC is the native gas token (18 decimals natively) and is also exposed as an
 * ERC-20 at 0x3600…0000 with 6 decimals. Same asset, two views: never mix them.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://explorer.arc.io" } },
});

export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
export const USDC_DECIMALS = 6;
/** EIP-7708: native USDC transfers emit an ERC-20 Transfer log from this address. Indexers must skip it. */
export const SYSTEM_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe" as const;
/** Arc's minimum base fee. Under-priced txs that skip estimation are accepted, never mine, and hold the nonce. */
export const MIN_BASE_FEE_WEI = 20_000_000_000n;
/** eth_getLogs is capped near 10,000 blocks (-32012). Stay under it. */
export const MAX_LOG_RANGE = 9_000n;

const RPCS: Record<number, string[]> = {
  [arcTestnet.id]: [
    "https://rpc.drpc.testnet.arc.io",
    "https://rpc.testnet.arc.io",
    "https://rpc.blockdaemon.testnet.arc.io",
    "https://rpc.quicknode.testnet.arc.io",
  ],
  [arcMainnet.id]: [
    "https://rpc.mainnet.arc.io",
    "https://rpc.drpc.mainnet.arc.io",
    "https://rpc.blockdaemon.mainnet.arc.io",
    "https://rpc.quicknode.mainnet.arc.io",
  ],
};

/**
 * Public Arc RPCs are load-balanced across backends at different heights and reset connections under load
 * (measured 2026-10-03: rpc.testnet.arc.io reset 4 sends in a row while dRPC succeeded). Fail over across providers.
 */
export function arcTransport(chainId: number, extra: string[] = []): Transport {
  const urls = [...extra, ...(RPCS[chainId] ?? [])];
  if (urls.length === 0) throw new Error(`no RPCs for chain ${chainId}`);
  return fallback(
    urls.map((u) => http(u, { timeout: 15_000, retryCount: 2, retryDelay: 400 })),
    { rank: false, retryCount: 2 },
  );
}

export function chainFor(chainId: number) {
  if (chainId === arcTestnet.id) return arcTestnet;
  if (chainId === arcMainnet.id) return arcMainnet;
  throw new Error(`unsupported chain ${chainId}`);
}

export function explorerTx(chainId: number, hash: string) {
  return `${chainFor(chainId).blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(chainId: number, address: string) {
  return `${chainFor(chainId).blockExplorers.default.url}/address/${address}`;
}
