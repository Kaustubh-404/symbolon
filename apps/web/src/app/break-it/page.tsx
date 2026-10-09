import type { Metadata } from "next";
import Link from "next/link";
import { explorerTx } from "@symbolon/sdk";
import { PageHead, Section } from "@/components/Page";
import { CHAIN_ID } from "@/lib/config";
import { SCENARIOS, SEEDED } from "@/lib/breakit";
import { BreakButton } from "./BreakButton";

export const metadata: Metadata = { title: "Break it" };

export default function BreakItPage() {
  return (
    <>
      <PageHead kicker="Make it fail" title="Try to make the agent pay something it shouldn't">
        <p>
          Each button below sends a <strong>real transaction</strong> to the Symbolon contract on Arc Testnet, signed with an
          agent key, asking it to pay a bill it must not pay. Showing the refusal matters more than showing a success: it proves
          the limit sits somewhere the agent cannot reach.
        </p>
        <p className="mt-2">
          The bills are demo fixtures, frozen on-chain in one refusal state each by{" "}
          <a href="https://github.com/Kaustubh-404/symbolon/blob/main/scripts/seed-break-it.sh">scripts/seed-break-it.sh</a>.
          Their funding is real: a Circle Mint sandbox transfer (
          <a href={explorerTx(CHAIN_ID, SEEDED.mintTx)}>Circle → treasury</a>, then{" "}
          <a href={explorerTx(CHAIN_ID, SEEDED.fundingTx)}>treasury → vault</a>). Every press shows up on{" "}
          <Link href="/refusals">/refusals</Link>.
        </p>
      </PageHead>

      <Section title="Seven ways to try" note="Rate-limited to one press every few seconds">
        <ol className="grid gap-6 md:grid-cols-2">
          {SCENARIOS.map((s, i) => (
            <li key={s.key} className="border border-rule bg-paper-2 p-5">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-ink-2">Attempt {i + 1}</p>
              <h3 className="mt-1 font-serif text-xl leading-snug">{s.title}</h3>
              <p className="mt-2 text-sm text-ink">{s.attack}</p>
              <p className="mt-3 text-sm text-ink-2">
                <span className="font-semibold text-ink">Expected refusal:</span> <span className="font-mono">{s.expect}</span>. {s.why}
              </p>
              <BreakButton scenario={s.key} expect={s.expect} />
            </li>
          ))}
        </ol>
      </Section>

      <Section title="What these buttons cannot do">
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Move money. The server runs the contract&apos;s dry run (<span className="font-mono">check</span>) first and sends
            nothing if the contract would accept the release.
          </li>
          <li>
            Use the real agent&apos;s key. They sign with a separate demo key that holds the AGENT role and about one test dollar of
            gas.
          </li>
          <li>
            Prove the witness is independent of our team. It is independent of the agent; see &ldquo;What this does not prove&rdquo; in
            the README.
          </li>
        </ul>
      </Section>
    </>
  );
}
