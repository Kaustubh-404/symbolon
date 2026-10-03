import Link from "next/link";
import { CONTRACT_URL, GITHUB_URL, SOURCE_URL } from "@/lib/config";
import { usdc } from "@/lib/format";
import type { Loaded } from "@/lib/loaded";
import { getStats } from "@/lib/stats";
import { Val } from "@/components/Val";

export const dynamic = "force-dynamic";

function Stat<T>({ label, l, render, note, tone }: { label: string; l: Loaded<T>; render: (v: T) => React.ReactNode; note?: string; tone?: "released" | "refused" }) {
  const color = tone === "released" ? "text-released" : tone === "refused" ? "text-refused" : "text-ink";
  return (
    <div className="border-t-2 border-ink pt-2">
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-ink-2">{label}</dt>
      <dd className={`mt-1 font-mono text-xl tabular-nums sm:text-2xl ${color}`}>
        <Val l={l}>{render}</Val>
      </dd>
      {note ? <dd className="mt-0.5 text-xs text-ink-2">{note}</dd> : null}
    </div>
  );
}

const COMPARISON: Array<[string, string]> = [
  ["Model output is the release condition", "Model output is a committed hash, an input. Release needs the document and the witness to fit"],
  ["releaseTimestamp stored, never read", "notBefore / dueBy enforced: TooEarly, PastDue"],
  ["Reconciles against the chain it writes", "The witness half comes from Circle Mint's ledger, a record the payer doesn't write"],
  ["A retry can pay twice", "AlreadySettled, and a dry run (check) that returns the exact revert release would produce"],
];

export default async function Home() {
  const s = await getStats();
  const n = (v: number | bigint) => v.toLocaleString("en-US");

  return (
    <>
      <section aria-labelledby="hero" className="grid gap-10 border-b border-ink pb-12 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div>
          <p className="mb-4 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-ink-2">Treasury agent · USDC on Arc · ERPNext</p>
          <h1 id="hero" className="font-serif text-5xl leading-[1.02] tracking-tight sm:text-6xl">
            Symbolon
            <span className="mt-2 block text-3xl italic text-ink-2 sm:text-4xl">Nothing pays until the halves fit.</span>
          </h1>
        </div>
        <p className="max-w-prose text-[1.0625rem] leading-relaxed">
          A business approves its bills in its accounting system. An AI agent decides when to pay each one, in digital
          dollars (USDC). But the agent cannot pay on its own say-so. A contract holds the money and refuses to release
          it until two independent halves match: the bill a <em>person</em> approved (who, how much, and when), and a
          separate <em>witness</em> confirming the money for that bill really arrived. The agent must also write its
          decision down a moment before it pays. If anything does not fit, the payment is refused, and the refusal is
          recorded publicly with a plain reason.
        </p>
      </section>

      <section aria-labelledby="live" className="mt-10">
        <h2 id="live" className="sr-only">Live figures</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-7">
          <Stat label="Obligations" l={s.obligationsRegistered} render={n} note="registered bills" />
          <Stat label="Released" l={s.releasedCount} render={n} note="payments made" tone="released" />
          <Stat label="Total released" l={s.totalReleased} render={usdc} note="USDC" tone="released" />
          <Stat label="Refusals mined" l={s.refusalsMined} render={n} note="reverted txs" tone="refused" />
          <Stat label="Vault" l={s.vaultBalance} render={usdc} note="USDC held" />
          <Stat label="Reserved" l={s.reserved} render={usdc} note="witnessed, unpaid" />
          <Stat label="Surplus" l={s.surplus} render={usdc} note="unreserved" />
        </dl>
        <p className="mt-4 text-xs text-ink-2">
          Live from Arc Testnet{s.head.ok ? <> at block <span className="font-mono">{s.head.value.toString()}</span></> : null}. USDC through its
          ERC-20 view (6 decimals). Refusals counted from the explorer&apos;s record of reverted transactions.{" "}
          <Link href="/api/stats" prefetch={false}>JSON</Link>
        </p>
      </section>

      <section aria-labelledby="halves" className="mt-16">
        <h2 id="halves" className="mb-6 font-serif text-3xl tracking-tight">Two halves, one release</h2>
        <div className="grid items-stretch gap-4 md:grid-cols-[1fr_1fr_auto_0.9fr] md:gap-0">
          <div className="half-left border border-ink bg-paper-2 p-5 pr-10">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-2">Half one · the document</p>
            <p className="mt-2 font-serif text-xl">The approved bill</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              From ERPNext&apos;s own approval flow: document hash, payee, amount, pay window. Registered by the approver
              key. The agent&apos;s key is rejected for this role (<code className="font-mono">RoleConflict</code>).
            </p>
          </div>
          <div className="half-right border border-ink bg-paper-3 p-5 pl-10">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-ink-2">Half two · the witness</p>
            <p className="mt-2 font-serif text-xl">The money arrived</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              A separate service reads Circle Mint&apos;s ledger and attests that this bill&apos;s funding landed. It
              cannot reserve money the vault does not hold (<code className="font-mono">Unfunded</code>).
            </p>
          </div>
          <div aria-hidden className="hidden items-center px-4 font-serif text-3xl text-ink-2 md:flex">→</div>
          <div className="border-2 border-released bg-released-bg p-5 text-ink">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-released">When they fit</p>
            <p className="mt-2 font-serif text-xl">Release</p>
            <p className="mt-2 text-sm leading-relaxed">
              The agent&apos;s decision hash, committed at least one block earlier, is an input. The contract pays the
              registered wallet the registered amount, or names exactly why not.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="compare" className="mt-16">
        <h2 id="compare" className="mb-2 font-serif text-3xl tracking-tight">arc-escrow vs Symbolon</h2>
        <p className="mb-6 max-w-3xl text-sm text-ink-2">
          Canteen&apos;s essay <a href="https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html"><em>Agents and Ledgers</em></a>{" "}
          criticises Circle&apos;s escrow sample, <a href="https://github.com/circlefin/arc-escrow">circlefin/arc-escrow</a>. Symbolon inverts each point.
        </p>
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">arc-escrow</th>
                <th scope="col">Symbolon</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([a, b]) => (
                <tr key={a}>
                  <td className="w-2/5 text-ink-2">{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="more" className="mt-16 grid gap-6 border-t border-ink pt-8 sm:grid-cols-3">
        <h2 id="more" className="sr-only">Go further</h2>
        <Link href="/refusals" className="group block no-underline">
          <p className="font-serif text-xl group-hover:underline">Refusals →</p>
          <p className="mt-1 text-sm text-ink-2">Every payment the contract refused, decoded into a sentence.</p>
        </Link>
        <Link href="/obligations" className="group block no-underline">
          <p className="font-serif text-xl group-hover:underline">Obligations →</p>
          <p className="mt-1 text-sm text-ink-2">Each bill&apos;s timeline: registered, witnessed, decided, paid or refused.</p>
        </Link>
        <div>
          <p className="font-serif text-xl">Source</p>
          <p className="mt-1 text-sm text-ink-2">
            <a href={GITHUB_URL}>GitHub</a> · <a href={CONTRACT_URL}>contract on Arcscan</a> · <a href={SOURCE_URL}>verified source</a>
          </p>
        </div>
      </section>
    </>
  );
}
