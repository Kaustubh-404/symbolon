import { NextResponse } from "next/server";
import { createWalletClient, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, arcTransport, decodeRefusal, explorerTx, symbolonAbi } from "@symbolon/sdk";
import { client } from "@/lib/client";
import { CHAIN_ID, SYMBOLON } from "@/lib/config";
import { FIXTURES, SCENARIOS } from "@/lib/breakit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-instance rate limit: one press every 6 s overall, and one per scenario every 20 s.
let lastAny = 0;
const lastByScenario = new Map<string, number>();

export async function POST(_req: Request, { params }: { params: Promise<{ scenario: string }> }) {
  const { scenario } = await params;
  const s = SCENARIOS.find((x) => x.key === scenario);
  if (!s) return NextResponse.json({ error: "unknown scenario" }, { status: 404 });

  const pk = process.env.BREAKIT_AGENT_PK as Hex | undefined;
  if (!pk) return NextResponse.json({ error: "this deployment has no demo agent key configured" }, { status: 503 });

  const now = Date.now();
  const wait = Math.max(lastAny + 6_000 - now, (lastByScenario.get(s.key) ?? 0) + 20_000 - now);
  if (wait > 0) return NextResponse.json({ error: `rate limited; try again in ${Math.ceil(wait / 1000)} s` }, { status: 429 });
  lastAny = now;
  lastByScenario.set(s.key, now);

  const id = FIXTURES[s.key];
  // Dry run first. If the contract would ACCEPT this release, send nothing: these buttons only ever demonstrate refusals.
  const dry = (await client.readContract({ address: SYMBOLON, abi: symbolonAbi, functionName: "check", args: [id] })) as Hex;
  const predicted = decodeRefusal(dry);
  if (!predicted) {
    return NextResponse.json({ error: "this fixture is releasable right now, so no transaction was sent" }, { status: 409 });
  }

  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ chain: arcTestnet, account, transport: arcTransport(CHAIN_ID) });
  const block = await client.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? 20_000_000_000n;
  // A fixed gas limit skips estimation (which would refuse to send a reverting call), so the refusal is MINED and
  // visible on the explorer. Fees follow the nonce-safe policy: never under 2x base fee.
  const hash = await wallet.sendTransaction({
    to: SYMBOLON,
    data: encodeFunctionData({ abi: symbolonAbi, functionName: "release", args: [id] }),
    gas: 120_000n,
    maxFeePerGas: base * 2n > 30_000_000_000n ? base * 2n : 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000 });

  return NextResponse.json({
    scenario: s.key,
    obligationId: id,
    tx: hash,
    txUrl: explorerTx(CHAIN_ID, hash),
    block: receipt.blockNumber.toString(),
    status: receipt.status, // "reverted" is the success condition here
    refusal: predicted.name,
    explanation: predicted.human,
    matchedExpectation: receipt.status === "reverted" && predicted.name === s.expect,
  });
}
