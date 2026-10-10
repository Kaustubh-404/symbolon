import Link from "next/link";
import { explorerTx } from "@symbolon/sdk";
import { CHAIN_ID, CONTRACT_URL, GITHUB_URL, SOURCE_URL } from "@/lib/config";
import { usd } from "@/lib/format";
import { attempt, EXPLORER_ERROR } from "@/lib/loaded";
import { getRefusals } from "@/lib/refusals";
import { getStats } from "@/lib/stats";
import { ruleLabel } from "@/lib/rules";
import { Val } from "@/components/Val";
import { ButtonLink, Card, Kicker, Proof, Seal, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    n: "1",
    title: "A person approves the bill",
    body: "In the company's normal accounting software (ERPNext). Approval writes the bill on-chain: who gets paid, how much, by when. This is the first half.",
  },
  {
    n: "2",
    title: "The AI decides, and writes down why",
    body: "Claude reviews every unpaid bill: pay now, wait, or ask a human. Its reasoning is fingerprinted on-chain before any money moves.",
  },
  {
    n: "3",
    title: "A witness confirms the money arrived",
    body: "A separate service checks Circle's own records and the chain. The AI can't play this role; the contract won't let it. This is the second half.",
  },
  {
    n: "4",
    title: "The contract pays, or refuses in public",
    body: "Only if the halves fit, the wallet is the one on the bill, it isn't already paid, and it's within limits. Otherwise it refuses and names the rule.",
  },
];

const COMPARISON: Array<[string, string]> = [
  ["Pays when the AI's answer says “valid, HIGH confidence”", "The AI's decision is an input. Payment needs the approved bill and the confirmed money to match"],
  ["Stores a release date and never checks it", "Enforces each bill's pay window: too early or too late is refused"],
  ["Checks the payment against the same chain it writes to", "Checks against Circle's own records, which the payer doesn't control"],
  ["A retry after a timeout can pay twice", "A paid bill can never be paid again, and a dry run shows the exact answer first"],
];

export default async function Home() {
  const [s, refusals] = await Promise.all([getStats(), attempt(getRefusals, EXPLORER_ERROR)]);
  const n = (v: number | bigint) => v.toLocaleString("en-US");
  const latest = refusals.ok ? refusals.value.refusals.find((r) => r.name !== "NoRevertData") : undefined;

  return (
    <>
      {/* ── Hero ── */}
      <section aria-labelledby="hero" className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 pb-14 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="rise-in">
          <Kicker className="mb-5">AI treasury agent · USDC on Arc · ERPNext</Kicker>
          <h1 id="hero" className="font-serif text-hero tracking-tight text-balance">
            Nothing pays until the halves fit.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
            An AI agent pays a company&apos;s bills in digital dollars. It decides; it can&apos;t overrule. A contract refuses any payment a person
            didn&apos;t approve, an independent witness didn&apos;t confirm, or a fraudster tried to redirect, and it says why, in public.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/try" size="lg">
              Try it yourself
            </ButtonLink>
            <ButtonLink href="/break-it" variant="ghost" size="lg">
              Try to break it
            </ButtonLink>
          </div>
        </div>

        <Card className="rise-in">
          <Kicker>Live from the contract</Kicker>
          <p className="mt-3 font-serif text-display tracking-tight">
            <span className="text-released">
              <Val l={s.releasedCount}>{n}</Val>
            </span>{" "}
            <span className="text-ink-3">paid</span> ·{" "}
            <span className="text-refused">
              <Val l={s.refusalsMined}>{n}</Val>
            </span>{" "}
            <span className="text-ink-3">refused</span>
          </p>
          <p className="mt-2 text-sm text-ink-2">Every payment and every refusal is a public transaction anyone can check.</p>
          {latest ? (
            <div className="mt-6 border-t border-rule pt-5">
              <p className="mb-3 text-xs text-ink-2">Most recent refusal</p>
              <Seal kind="refused" rule={`Rule: ${ruleLabel(latest.name)}`} note="No money moved." />
              <p className="mt-3 text-sm">{latest.human}</p>
              <div className="mt-2">
                <Proof href={explorerTx(CHAIN_ID, latest.hash)} />
              </div>
            </div>
          ) : null}
        </Card>
      </section>

      {/* ── Supporting figures ── */}
      <section aria-labelledby="figures" className="border-y border-rule py-8">
        <h2 id="figures" className="sr-only">Live figures</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          <Stat label="Bills approved" value={<Val l={s.obligationsRegistered}>{n}</Val>} note="registered from the books" />
          <Stat label="Paid out" value={<Val l={s.totalReleased}>{usd}</Val>} tone="released" note="test USDC" />
          <Stat label="Waiting to be paid" value={<Val l={s.reserved}>{usd}</Val>} note="money confirmed, not yet paid" />
          <Stat label="Held by the contract" value={<Val l={s.vaultBalance}>{usd}</Val>} note="test USDC in the vault" />
        </dl>
        <p className="mt-6 text-xs text-ink-2">
          Read live from Arc Testnet{s.head.ok ? <> at block <span className="font-mono tabular-nums">{s.head.value.toString()}</span></> : null}.{" "}
          <Link href="/api/stats" prefetch={false}>Raw data</Link>
        </p>
      </section>

      {/* ── How a payment happens ── */}
      <section aria-labelledby="how" className="mt-16">
        <h2 id="how" className="font-serif text-h1 tracking-tight">
          How a payment happens
        </h2>
        <p className="mt-2 max-w-2xl text-ink-2">
          A <em>symbolon</em> was a token broken in two; a deal was real only when the halves fit. Here the halves are the approved bill and the
          confirmed money.
        </p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((st) => (
            <Card as="li" key={st.n} className="flex flex-col">
              <span aria-hidden className="grid size-9 place-items-center rounded-full border border-rule-strong/70 font-mono text-sm">
                {st.n}
              </span>
              <h3 className="mt-4 font-semibold leading-snug">{st.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{st.body}</p>
            </Card>
          ))}
        </ol>
      </section>

      {/* ── Why not the usual way ── */}
      <section aria-labelledby="compare" className="mt-16">
        <h2 id="compare" className="font-serif text-h1 tracking-tight">
          Why not let the AI just pay?
        </h2>
        <p className="mt-2 max-w-3xl text-ink-2">
          Canteen&apos;s essay <a href="https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html"><em>Agents and Ledgers</em></a> criticises
          Circle&apos;s own escrow sample (<a href="https://github.com/circlefin/arc-escrow">circlefin/arc-escrow</a>) for exactly that. Symbolon inverts each point.
        </p>
        <div className="mt-8 overflow-hidden rounded-card border border-rule">
          <div className="hidden grid-cols-2 border-b border-rule bg-paper-2 text-kicker font-semibold uppercase tracking-[0.14em] text-ink-2 md:grid">
            <p className="px-5 py-3">Circle&apos;s sample escrow</p>
            <p className="border-l border-rule px-5 py-3">Symbolon</p>
          </div>
          <ul>
            {COMPARISON.map(([a, b]) => (
              <li key={a} className="grid border-b border-rule last:border-b-0 md:grid-cols-2">
                <p className="flex gap-3 px-5 py-4 text-ink-2">
                  <span aria-hidden className="text-refused">✕</span>
                  <span>
                    <span className="sr-only">Sample escrow: </span>
                    {a}
                  </span>
                </p>
                <p className="flex gap-3 border-rule bg-raised px-5 py-4 md:border-l">
                  <span aria-hidden className="text-released">✓</span>
                  <span>
                    <span className="sr-only">Symbolon: </span>
                    {b}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Go further ── */}
      <section aria-labelledby="more" className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <h2 id="more" className="sr-only">Go further</h2>
        {[
          { href: "/try", t: "Try it yourself", d: "Send a bill through the real pipeline and watch it get paid, or refused." },
          { href: "/break-it", t: "Try to break it", d: "Seven ways to make it pay wrongly. Each sends a real transaction." },
          { href: "/refusals", t: "Every refusal", d: "Each payment the contract refused, with the rule it broke." },
          { href: "/obligations", t: "Every bill", d: "Each bill's story: approved, decided, confirmed, paid or refused." },
        ].map((x) => (
          <Link key={x.href} href={x.href} className="group rounded-card border border-rule p-5 no-underline transition hover:-translate-y-0.5 hover:bg-raised hover:shadow-card">
            <p className="font-semibold">
              {x.t} <span aria-hidden className="inline-block transition group-hover:translate-x-0.5">→</span>
            </p>
            <p className="mt-1 text-sm text-ink-2">{x.d}</p>
          </Link>
        ))}
      </section>
      <p className="mt-8 text-sm text-ink-2">
        Source: <a href={GITHUB_URL}>GitHub</a> · <a href={CONTRACT_URL}>contract on Arcscan</a> · <a href={SOURCE_URL}>verified source code</a>
      </p>
    </>
  );
}
