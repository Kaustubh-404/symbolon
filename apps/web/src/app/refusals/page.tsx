import type { Metadata } from "next";
import Link from "next/link";
import { explorerAddress, explorerTx } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { isoToUtc } from "@/lib/format";
import { EXPLORER_ERROR, attempt } from "@/lib/loaded";
import { getRefusals } from "@/lib/refusals";
import { ruleLabel, shortenInText } from "@/lib/rules";
import { Hash } from "@/components/Hash";
import { PageHead, Unavailable } from "@/components/Page";
import { ButtonLink, Empty, Proof, Seal } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Refusals" };

export default async function RefusalsPage() {
  const res = await attempt(getRefusals, EXPLORER_ERROR);
  const count = res.ok ? res.value.refusals.length : null;

  return (
    <>
      <PageHead
        kicker="Every refusal, in public"
        title={
          <>
            {count !== null ? <span className="text-refused">{count.toLocaleString("en-US")}</span> : null} payments the contract refused
          </>
        }
        aside={<ButtonLink href="/break-it" variant="ghost">Add one yourself</ButtonLink>}
      >
        <p>
          Each time something asked the contract to pay and it said no, it left a public record naming the rule that was broken. Nothing is hidden or
          retried quietly. Newest first.
        </p>
      </PageHead>

      {!res.ok ? (
        <Unavailable what="The refusal log" reason={res.reason} />
      ) : res.value.refusals.length === 0 ? (
        <Empty title="No refusals yet" action={<ButtonLink href="/break-it">Try to break it</ButtonLink>}>
          Nothing has been refused so far. Send one from the break-it page and it appears here within seconds.
        </Empty>
      ) : (
        <ol className="space-y-4">
          {res.value.refusals.map((r) => (
            <li key={r.hash} className="rounded-card border border-rule bg-raised p-5 shadow-card sm:p-6">
              <div className="grid gap-5 md:grid-cols-[minmax(0,15rem)_1fr]">
                <div>
                  <Seal kind="refused" size="sm" rule={`Rule: ${ruleLabel(r.name)}`} />
                  <p className="mt-3 text-xs text-ink-2">
                    {r.timestamp ? <time dateTime={r.timestamp}>{isoToUtc(r.timestamp)}</time> : null}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[0.9375rem] leading-relaxed" title={r.human}>
                    {shortenInText(r.human)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Proof href={explorerTx(CHAIN_ID, r.hash)}>See the refused transaction</Proof>
                    {r.obligationId ? (
                      <Link href={`/obligations/${r.obligationId}`} className="text-[0.8125rem] text-ink-2 hover:text-ink">
                        The bill&apos;s full story →
                      </Link>
                    ) : null}
                  </div>
                  <details className="group mt-3 text-xs text-ink-2">
                    <summary className="cursor-pointer select-none list-none font-medium hover:text-ink">
                      <span aria-hidden className="mr-1 inline-block transition group-open:rotate-90">›</span>
                      Technical details
                    </summary>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
                      <dt>Contract error</dt>
                      <dd className="font-mono">{r.name}</dd>
                      <dt>Transaction</dt>
                      <dd>
                        <Hash value={r.hash} href={explorerTx(CHAIN_ID, r.hash)} />
                      </dd>
                      <dt>Function called</dt>
                      <dd className="font-mono">{r.method ?? "unknown"}</dd>
                      {r.from ? (
                        <>
                          <dt>Sent by</dt>
                          <dd>
                            <Hash value={r.from} href={explorerAddress(CHAIN_ID, r.from)} />
                          </dd>
                        </>
                      ) : null}
                      <dt>Block</dt>
                      <dd className="font-mono tabular-nums">{r.blockNumber.toString()}</dd>
                      <dt>Reason read from</dt>
                      <dd>{r.decodedFrom === "replay" ? "replaying the call against the chain" : r.decodedFrom}</dd>
                    </dl>
                  </details>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {res.ok ? (
        <p className="mt-6 text-xs text-ink-2">
          {res.value.scannedTxs} transactions to the contract checked via the Arcscan explorer{res.value.truncated ? "; older pages not checked" : ""}.
          {res.value.otherReverted > 0
            ? ` ${res.value.otherReverted} other failed transaction${res.value.otherReverted === 1 ? "" : "s"} to the contract address ${
                res.value.otherReverted === 1 ? "was" : "were"
              } not a call to it (e.g. a plain USDC send it can't accept) and ${res.value.otherReverted === 1 ? "isn't" : "aren't"} counted as refusals.`
            : ""}{" "}
          <Link href="/api/refusals" prefetch={false}>
            Raw data
          </Link>
        </p>
      ) : null}
    </>
  );
}
