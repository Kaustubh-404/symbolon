import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { explorerAddress, explorerTx } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { isZeroHash, usd, utc } from "@/lib/format";
import { getObligationDetail, type TimelineTone } from "@/lib/obligations";
import { plainAction, plainStatus, ruleLabel, shortHash as short, shortenInText } from "@/lib/rules";
import { Hash } from "@/components/Hash";
import { Unknown, Val } from "@/components/Val";
import { AsOf, PageHead, Section, Unavailable } from "@/components/Page";
import { Chip, Proof, Seal } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ID_RE = /^0x[0-9a-fA-F]{64}$/;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  return { title: `Bill ${id.slice(0, 10)}…` };
}

const dot: Record<TimelineTone, string> = {
  neutral: "bg-raised border-ink",
  human: "bg-ink border-ink",
  released: "bg-released border-released",
  refused: "bg-refused border-refused",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule py-3 last:border-b-0 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-xs font-semibold text-ink-2">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm sm:mt-0">{children}</dd>
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
        <PageHead kicker="Bill" title={<span className="font-mono">{short(id, 8)}</span>} />
        <Unavailable what="This bill" reason={res.reason} />
      </>
    );
  }

  const { row, timeline, check, refusalsSource, head } = res.value!;
  const st = row.onchain;

  return (
    <>
      <p className="mb-6 text-sm">
        <Link href="/obligations" className="text-ink-2 no-underline hover:text-ink">
          ← All bills
        </Link>
      </p>
      <PageHead
        kicker={`Bill ${short(row.id, 6)}`}
        title={
          <>
            <span className="font-mono tabular-nums">{usd(row.amount)}</span> to <span className="font-mono">{short(row.payee, 4)}</span>
          </>
        }
        aside={<Val l={st}>{(o) => <Chip tone={plainStatus(o.status).tone}>{plainStatus(o.status).label}</Chip>}</Val>}
      >
        <p>
          Payable from {utc(row.notBefore)} until {utc(row.dueBy)}.{" "}
          <Proof href={explorerAddress(CHAIN_ID, row.payee)}>The supplier&apos;s wallet</Proof>
        </p>
      </PageHead>

      {/* ── What the contract would do right now ── */}
      <section aria-labelledby="dry-run" className="mb-12 rounded-card border border-rule bg-raised p-5 shadow-card sm:p-6">
        <h2 id="dry-run" className="text-sm font-semibold text-ink-2">
          If the AI asked to pay this bill right now
        </h2>
        <div className="mt-4">
          <Val l={check}>
            {(c) =>
              st.ok && st.value.status === 2 ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Seal kind="paid" rule="Rule: can't be paid twice" note="Any retry is refused." />
                  <p className="text-sm text-ink-2">
                    This bill is already paid. Asking again would be refused with &ldquo;{ruleLabel(c.refusal?.name ?? "AlreadySettled")}&rdquo;, however many times it&apos;s retried.
                  </p>
                </div>
              ) : c.refusal === null ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Seal kind="paid" rule="Every rule holds" note="The contract would pay it." />
                  <p className="text-sm text-ink-2">Both halves fit, the decision is on record from an earlier block, and every limit holds.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Seal kind="refused" rule={`Rule: ${ruleLabel(c.refusal.name)}`} note="No money would move." />
                  <p className="text-[0.9375rem]" title={c.refusal.human}>
                    {shortenInText(c.refusal.human)}
                  </p>
                </div>
              )
            }
          </Val>
        </div>
        <p className="mt-4 text-xs text-ink-2">
          This is the contract&apos;s own dry run (<code className="font-mono">check</code>), read at block{" "}
          <span className="font-mono tabular-nums">{head.toString()}</span>. It returns exactly what a real payment attempt would.
        </p>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr]">
        <Section title="Its story" note="in the order it happened on-chain">
          {refusalsSource.ok ? null : <p className="mb-3 text-xs text-ink-2">Refusals for this bill are {refusalsSource.reason}; only the other steps are shown.</p>}
          <ol className="relative ml-2 border-l border-rule">
            {timeline.map((t) => (
              <li key={t.key} className="relative pb-7 pl-7 last:pb-0">
                <span aria-hidden className={`absolute -left-[7px] top-1 size-[13px] rounded-full border-2 ${dot[t.tone]}`} />
                <p className={`font-semibold ${t.tone === "refused" ? "text-refused" : t.tone === "released" ? "text-released" : ""}`}>{t.title}</p>
                <p className="mt-0.5 text-xs text-ink-2">
                  {t.who} · {t.timestamp.ok ? utc(t.timestamp.value) : <Unknown reason="time unavailable (RPC error)" />}
                </p>
                <ul className="mt-1.5 space-y-0.5 text-sm text-ink-2">
                  {t.lines.map((l) => (
                    <li key={l} className="break-words" title={l}>
                      {shortenInText(l)}
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5">
                  <Proof href={explorerTx(CHAIN_ID, t.txHash)} />
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Details" note="read from the contract, live">
          <dl className="rounded-card border border-rule bg-raised px-5 shadow-card">
            <Field label="Status">
              <Val l={st}>{(o) => plainStatus(o.status).label}</Val>
            </Field>
            <Field label="Amount">
              <span className="font-mono tabular-nums">{usd(row.amount)}</span> <span className="text-ink-2">test USDC</span>
            </Field>
            <Field label="Pays wallet">
              <Hash value={row.payee} href={explorerAddress(CHAIN_ID, row.payee)} />
            </Field>
            <Field label="Pay window">
              {utc(row.notBefore)} → {utc(row.dueBy)} <span className="text-ink-2">(about {Math.max(1, Math.round(Number(row.dueBy - row.notBefore) / 86_400))} days)</span>
            </Field>
            <Field label="AI decided">
              <Val l={st}>
                {(o) =>
                  isZeroHash(o.decisionHash) ? (
                    <span className="text-ink-2">Not yet</span>
                  ) : (
                    <>
                      {plainAction(o.action)} <span className="text-ink-2">· fingerprint</span> <Hash value={o.decisionHash} keep={4} />
                    </>
                  )
                }
              </Val>
            </Field>
            <Field label="Money confirmed">
              <Val l={st}>
                {(o) =>
                  isZeroHash(o.witnessDigest) ? (
                    <span className="text-ink-2">Not yet</span>
                  ) : (
                    <>
                      <span className="font-mono tabular-nums">{usd(o.witnessedAmount)}</span> <span className="text-ink-2">· evidence</span> <Hash value={o.witnessDigest} keep={4} />
                    </>
                  )
                }
              </Val>
            </Field>
            <Field label="Second signature">
              <Val l={st}>{(o) => (o.cosigned ? "Yes" : "No")}</Val>
            </Field>
            <Field label="Document fingerprint">
              <Hash value={row.docHash} keep={4} />
            </Field>
            <Field label="Supplier id">
              <Hash value={row.payeeId} keep={4} />
            </Field>
            <Field label="Bill id">
              <Hash value={row.id} keep={4} />
            </Field>
          </dl>
        </Section>
      </div>
      <AsOf block={head} />
    </>
  );
}
