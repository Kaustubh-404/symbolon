import type { Metadata } from "next";
import Link from "next/link";
import { explorerAddress, explorerTx } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { EXPLORER_ERROR, attempt } from "@/lib/loaded";
import { getRefusals } from "@/lib/refusals";
import { Hash } from "@/components/Hash";
import { PageHead, Unavailable } from "@/components/Page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refusals" };

export default async function RefusalsPage() {
  const res = await attempt(getRefusals, EXPLORER_ERROR);

  return (
    <>
      <PageHead kicker="Make repair loud" title={<>Refusals <span className="text-refused">mined on-chain</span></>}>
        Every transaction sent to Symbolon that the contract reverted. Each refusal is a named custom error, decoded here
        into the sentence a non-engineer can act on. A refusal costs the agent gas and leaves a public record; it is
        never a silent retry.
      </PageHead>

      {!res.ok ? (
        <Unavailable what="Refusals" reason={res.reason} />
      ) : res.value.refusals.length === 0 ? (
        <p className="text-ink-2">No reverted transactions yet ({res.value.scannedTxs} transactions scanned).</p>
      ) : (
        <ol className="space-y-4">
          {res.value.refusals.map((r) => (
            <li key={r.hash} className="border-l-4 border-refused bg-paper-2 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-mono text-lg text-refused">{r.name}</p>
                <p className="text-xs text-ink-2">
                  block <span className="font-mono">{r.blockNumber.toString()}</span>
                  {r.timestamp ? <> · <time dateTime={r.timestamp}>{r.timestamp.slice(0, 16).replace("T", " ")} UTC</time></> : null}
                </p>
              </div>
              <p className="mt-2 max-w-3xl text-[0.9375rem]">{r.human}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-[auto_1fr]">
                <dt>Transaction</dt>
                <dd><Hash value={r.hash} href={explorerTx(CHAIN_ID, r.hash)} /></dd>
                <dt>Call</dt>
                <dd className="font-mono">{r.method ?? "unknown method"}</dd>
                {r.from ? (
                  <>
                    <dt>Sender</dt>
                    <dd><Hash value={r.from} href={explorerAddress(CHAIN_ID, r.from)} /></dd>
                  </>
                ) : null}
                {r.obligationId ? (
                  <>
                    <dt>Obligation</dt>
                    <dd><Link href={`/obligations/${r.obligationId}`} className="font-mono" title={r.obligationId}>{r.obligationId.slice(0, 10)}…{r.obligationId.slice(-4)}</Link></dd>
                  </>
                ) : null}
                <dt>Decoded from</dt>
                <dd>{r.decodedFrom}</dd>
              </dl>
            </li>
          ))}
        </ol>
      )}
      {res.ok ? (
        <p className="mt-6 text-xs text-ink-2">
          {res.value.scannedTxs} transactions to the contract scanned via the Arcscan (Blockscout) API{res.value.truncated ? "; older pages not scanned" : ""}.
          Newest first by block. <Link href="/api/refusals" prefetch={false}>JSON</Link>
        </p>
      ) : null}
    </>
  );
}
