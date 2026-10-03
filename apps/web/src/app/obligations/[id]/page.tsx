import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { explorerAddress, explorerTx } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { actionName, duration, isZeroHash, statusName, usdc, utc } from "@/lib/format";
import { getObligationDetail, type TimelineTone } from "@/lib/obligations";
import { Hash } from "@/components/Hash";
import { Badge, statusTone } from "@/components/Badge";
import { Unknown, Val } from "@/components/Val";
import { AsOf, PageHead, Section, Unavailable } from "@/components/Page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: `Obligation ${id.slice(0, 10)}…` };
}

const dot: Record<TimelineTone, string> = {
  neutral: "bg-paper border-ink",
  human: "bg-ink border-ink",
  released: "bg-released border-released",
  refused: "bg-refused border-refused",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule py-2 sm:grid sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-2">{label}</dt>
      <dd className="mt-0.5 break-all text-sm sm:mt-0">{children}</dd>
    </div>
  );
}

export default async function ObligationPage({ params }: Params) {
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();

  const res = await getObligationDetail(id as Hex);
  if (res.ok && res.value === null) notFound();

  if (!res.ok) {
    return (
      <>
        <PageHead kicker="Obligation" title={<span className="break-all font-mono text-xl sm:text-2xl">{id}</span>} />
        <Unavailable what="This obligation" reason={res.reason} />
      </>
    );
  }

  const { row, timeline, check, refusalsSource, head } = res.value!;
  const st = row.onchain;

  return (
    <>
      <PageHead kicker="Obligation" title={<span className="break-all font-mono text-xl sm:text-2xl">{row.id}</span>}>
        {usdc(row.amount)} USDC to <span className="font-mono">{row.payee}</span>, payable {utc(row.notBefore)} → {utc(row.dueBy)}.
      </PageHead>

      <section aria-labelledby="dry-run" className="mb-10">
        <h2 id="dry-run" className="sr-only">Dry run</h2>
        <Val l={check}>
          {(c) =>
            c.refusal === null ? (
              <div className="border-2 border-released bg-released-bg p-5">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-released">check(id) now</p>
                <p className="mt-1 font-serif text-2xl">Releasable now ✅</p>
                <p className="mt-1 text-sm">Both halves fit, the decision predates this block, and every limit holds. <code className="font-mono">release(id)</code> would pay.</p>
              </div>
            ) : (
              <div className="border-2 border-refused bg-refused-bg p-5">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-refused">check(id) now · release would refuse</p>
                <p className="mt-1 font-mono text-xl text-refused">{c.refusal.name}</p>
                <p className="mt-1 text-[0.9375rem]">{c.refusal.human}</p>
              </div>
            )
          }
        </Val>
        <p className="mt-2 text-xs text-ink-2">
          <code className="font-mono">check(id)</code> is a view that returns exactly the revert <code className="font-mono">release(id)</code> would
          produce at block {head.toString()}.
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <Section title="Timeline" note="ordered by block, never by timestamp">
          {refusalsSource.ok ? null : (
            <p className="mb-3 text-xs text-ink-2">Mined refusals for this bill are {refusalsSource.reason}; only events are shown.</p>
          )}
          <ol className="relative ml-2 border-l border-rule">
            {timeline.map((t) => (
              <li key={t.key} className="relative pb-6 pl-6">
                <span aria-hidden className={`absolute -left-[6px] top-1.5 size-[11px] rounded-full border-2 ${dot[t.tone]}`} />
                <p className={`font-medium ${t.tone === "refused" ? "text-refused" : t.tone === "released" ? "text-released" : ""}`}>{t.title}</p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {t.who} · block <span className="font-mono">{t.blockNumber.toString()}</span> ·{" "}
                  {t.timestamp.ok ? utc(t.timestamp.value) : <Unknown reason="time unavailable (RPC error)" />} ·{" "}
                  <Hash value={t.txHash} href={explorerTx(CHAIN_ID, t.txHash)} keep={4} />
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {t.lines.map((l) => (
                    <li key={l} className="break-all">{l}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="State" note="getObligation(id), live">
          <dl>
            <Field label="Status"><Val l={st}>{(o) => <Badge tone={statusTone(statusName(o.status))}>{statusName(o.status)}</Badge>}</Val></Field>
            <Field label="Payee id"><Hash value={row.payeeId} /></Field>
            <Field label="Payee wallet"><Hash value={row.payee} href={explorerAddress(CHAIN_ID, row.payee)} /></Field>
            <Field label="Amount"><span className="font-mono">{usdc(row.amount)}</span> USDC</Field>
            <Field label="Window">{utc(row.notBefore)} → {utc(row.dueBy)} <span className="text-ink-2">({duration(row.dueBy - row.notBefore)})</span></Field>
            <Field label="Document hash"><Hash value={row.docHash} /></Field>
            <Field label="Decision">
              <Val l={st}>{(o) => (isZeroHash(o.decisionHash) ? <span className="text-ink-2">— none committed</span> : <>{actionName(o.action)} at block <span className="font-mono">{o.decidedBlock.toString()}</span> · <Hash value={o.decisionHash} /></>)}</Val>
            </Field>
            <Field label="Witness">
              <Val l={st}>{(o) => (isZeroHash(o.witnessDigest) ? <span className="text-ink-2">— not attested</span> : <><span className="font-mono">{usdc(o.witnessedAmount)}</span> USDC · <Hash value={o.witnessDigest} /></>)}</Val>
            </Field>
            <Field label="Funding ref">
              <Val l={st}>{(o) => (isZeroHash(o.fundingRef) ? <span className="text-ink-2">—</span> : <Hash value={o.fundingRef} />)}</Val>
            </Field>
            <Field label="Co-signed"><Val l={st}>{(o) => (o.cosigned ? "yes" : "no")}</Val></Field>
            <Field label="Registered"><Hash value={row.registeredTx} href={explorerTx(CHAIN_ID, row.registeredTx)} /> <span className="text-ink-2">block {row.registeredBlock.toString()}</span></Field>
          </dl>
        </Section>
      </div>
      <AsOf block={head} />
    </>
  );
}
