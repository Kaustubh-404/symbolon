import { createPublicClient } from "viem";
import { arcTestnet, arcTransport } from "@symbolon/sdk";
import { CHAIN_ID } from "./config";

/** Server-side reader. `arcTransport` fails over across Arc's public RPC providers. */
export const client = createPublicClient({ chain: arcTestnet, transport: arcTransport(CHAIN_ID) });
