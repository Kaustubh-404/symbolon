import type { Metadata } from "next";
import Link from "next/link";
import { explorerTx } from "@symbolon/sdk";
import { PageHead, Section } from "@/components/Page";
import { CHAIN_ID } from "@/lib/config";
import { SCENARIOS, SEEDED } from "@/lib/breakit";
import { ruleLabel } from "@/lib/rules";
import { Card, Chip, Kicker } from "@/components/ui";
import { BreakButton } from "./BreakButton";

export const metadata: Metadata = { title: "Try to break it" };

export default function BreakItPage() {
  return (
    <>
      <PageHead kicker="Try to break it" title="Seven ways to make it pay something it shouldn't">
        <p>
          Each button sends a <strong className="text-ink">real transaction</strong> to the contract on Arc, signed with an AI agent&apos;s key, asking
          it to pay a bill it must not pay. Watching it refuse is the point: the limit sits somewhere the AI can&apos;t reach.
        </p>
        <p>
          The bills are demo bills, each frozen in one bad state. Their money is real test USDC from Circle (
          <a href={explorerTx(CHAIN_ID, SEEDED.mintTx)}>Circle → treasury</a>, then <a href={explorerTx(CHAIN_ID, SEEDED.fundingTx)}>treasury → contract</a>
          ). Every press shows up in <Link href="/refusals">the refusals log</Link>.
        </p>
      </PageHead>

      <ol className="grid gap-5 md:grid-cols-2">
        {SCENARIOS.map((s, i) => (
          <Card as="li" key={s.key} className="flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <Kicker>Attempt {i + 1}</Kicker>
              <Chip tone="refused">Expect: {ruleLabel(s.expect)}</Chip>
            </div>
            <h2 className="mt-3 font-serif text-h2 leading-snug tracking-tight">{s.title}</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed">{s.attack}</p>
            <details className="group mt-3 text-sm text-ink-2">
              <summary className="cursor-pointer select-none list-none font-medium text-ink-2 hover:text-ink">
                <span aria-hidden className="mr-1 inline-block transition group-open:rotate-90">›</span>
                Why the contract says no
              </summary>
              <p className="mt-2 leading-relaxed">
                {s.why} <span className="font-mono text-xs">({s.expect})</span>
              </p>
            </details>
            <BreakButton scenario={s.key} expect={s.expect} />
          </Card>
        ))}
      </ol>

      <Section title="What these buttons can't do">
        <ul className="grid gap-4 text-sm text-ink-2 md:grid-cols-3">
          <li className="rounded-card border border-rule p-4">
            <p className="font-semibold text-ink">Move money</p>
            <p className="mt-1">The server asks the contract for a dry run first and sends nothing if it would accept the payment.</p>
          </li>
          <li className="rounded-card border border-rule p-4">
            <p className="font-semibold text-ink">Use the real agent&apos;s key</p>
            <p className="mt-1">They sign with a separate demo key that holds the agent role and about one test dollar for fees.</p>
          </li>
          <li className="rounded-card border border-rule p-4">
            <p className="font-semibold text-ink">Prove the witness is independent of us</p>
            <p className="mt-1">It&apos;s independent of the AI agent, not of our team. The README says so under &ldquo;What this does not prove&rdquo;.</p>
          </li>
        </ul>
      </Section>
    </>
  );
}
