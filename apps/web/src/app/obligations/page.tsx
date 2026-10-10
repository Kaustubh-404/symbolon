import type { Metadata } from "next";
import Link from "next/link";
import { explorerAddress } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { isZeroHash, usd, utc } from "@/lib/format";
import { listObligations } from "@/lib/obligations";
import { plainAction, plainStatus } from "@/lib/rules";
import { Hash } from "@/components/Hash";
import { Val } from "@/components/Val";
import { AsOf, PageHead, Unavailable } from "@/components/Page";
import { ButtonLink, Chip, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bills" };

const Dash = ({ why }: { why: string }) => (
  <span className="text-ink-3" title={why}>
    —
  </span>
);

export default async function ObligationsPage() {
  const list = await listObligations();

  return (
    <>
      <PageHead
        kicker="Every bill"
        title="Bills a person approved"
        aside={<ButtonLink href="/try" variant="ghost">Add a bill</ButtonLink>}
      >
        <p>
          Every bill approved in the books and written on-chain, with its live state. Open one to see its full story. A dash means that step
          hasn&apos;t happened yet; &ldquo;unavailable&rdquo; means a read failed (never a hidden zero).
        </p>
      </PageHead>

      {!list.ok ? (
        <Unavailable what="The bills" reason={list.reason} />
      ) : list.value.rows.length === 0 ? (
        <Empty title="No bills yet" action={<ButtonLink href="/try">Send the first bill</ButtonLink>}>
          Approved bills appear here as soon as they're written on-chain.
        </Empty>
      ) : (
        <div className="table-wrap rounded-card border border-rule bg-raised px-4 shadow-card sm:px-6">
          <table className="ledger">
            <caption className="pt-4">
              {list.value.rows.length} bill{list.value.rows.length === 1 ? "" : "s"}, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Bill</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Pays</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col">AI decided</th>
                <th scope="col">Money confirmed</th>
              </tr>
            </thead>
            <tbody>
              {list.value.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/obligations/${r.id}`} className="font-mono text-[0.8125rem] font-medium" title={r.id}>
                      {r.id.slice(0, 8)}…{r.id.slice(-4)}
                    </Link>
                  </td>
                  <td className="num">{usd(r.amount)}</td>
                  <td>
                    <Hash value={r.payee} href={explorerAddress(CHAIN_ID, r.payee)} keep={4} />
                  </td>
                  <td className="whitespace-nowrap text-xs text-ink-2">{utc(r.dueBy).slice(0, 10)}</td>
                  <td>
                    <Val l={r.onchain}>
                      {(o) => {
                        const s = plainStatus(o.status);
                        return <Chip tone={s.tone}>{s.label}</Chip>;
                      }}
                    </Val>
                  </td>
                  <td className="whitespace-nowrap">
                    <Val l={r.onchain}>{(o) => (o.action === 0 ? <Dash why="No decision recorded yet" /> : plainAction(o.action))}</Val>
                  </td>
                  <td className="whitespace-nowrap">
                    <Val l={r.onchain}>
                      {(o) => (isZeroHash(o.witnessDigest) ? <Dash why="The witness hasn't confirmed money for this bill" /> : <span className="font-mono tabular-nums">{usd(o.witnessedAmount)}</span>)}
                    </Val>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AsOf block={list.ok ? list.value.head : undefined} />
    </>
  );
}
