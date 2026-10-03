import type { Metadata } from "next";
import Link from "next/link";
import { explorerAddress, explorerTx } from "@symbolon/sdk";
import { CHAIN_ID } from "@/lib/config";
import { isZeroHash, statusName, usdc, utc } from "@/lib/format";
import { listObligations } from "@/lib/obligations";
import { Hash } from "@/components/Hash";
import { Badge, statusTone } from "@/components/Badge";
import { Val } from "@/components/Val";
import { AsOf, PageHead, Unavailable } from "@/components/Page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Obligations" };

const Dash = ({ why }: { why: string }) => (
  <span className="text-ink-2" title={why}>
    —
  </span>
);

export default async function ObligationsPage() {
  const list = await listObligations();

  return (
    <>
      <PageHead kicker="The document half" title="Obligations">
        Every bill a human approved and registered on-chain, from <code className="font-mono">ObligationRegistered</code>{" "}
        events, with its live state from <code className="font-mono">getObligation</code>. A dash means the step has not
        happened yet; &ldquo;unavailable&rdquo; means a read failed.
      </PageHead>

      {!list.ok ? (
        <Unavailable what="Obligations" reason={list.reason} />
      ) : list.value.rows.length === 0 ? (
        <p className="text-ink-2">No obligations registered yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <caption>{list.value.rows.length} obligation{list.value.rows.length === 1 ? "" : "s"}, newest first by block</caption>
            <thead>
              <tr>
                <th scope="col">Obligation</th>
                <th scope="col">Payee id</th>
                <th scope="col">Payee wallet</th>
                <th scope="col" className="num">Amount (USDC)</th>
                <th scope="col">Pay window</th>
                <th scope="col">Status</th>
                <th scope="col">Decision</th>
                <th scope="col">Witness</th>
              </tr>
            </thead>
            <tbody>
              {list.value.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/obligations/${r.id}`} className="font-mono text-[0.8125rem]" title={r.id}>
                      {r.id.slice(0, 10)}…{r.id.slice(-4)}
                    </Link>
                    <div className="mt-0.5 text-xs text-ink-2">
                      block{" "}
                      <a href={explorerTx(CHAIN_ID, r.registeredTx)} className="font-mono">
                        {r.registeredBlock.toString()}
                      </a>
                    </div>
                  </td>
                  <td><Hash value={r.payeeId} /></td>
                  <td><Hash value={r.payee} href={explorerAddress(CHAIN_ID, r.payee)} /></td>
                  <td className="num">{usdc(r.amount)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {utc(r.notBefore)}
                    <br />→ {utc(r.dueBy)}
                  </td>
                  <td>
                    <Val l={r.onchain}>{(o) => <Badge tone={statusTone(statusName(o.status))}>{statusName(o.status)}</Badge>}</Val>
                  </td>
                  <td>
                    <Val l={r.onchain}>{(o) => (isZeroHash(o.decisionHash) ? <Dash why="No decision committed yet" /> : <Hash value={o.decisionHash} />)}</Val>
                  </td>
                  <td>
                    <Val l={r.onchain}>{(o) => (isZeroHash(o.witnessDigest) ? <Dash why="No witness attestation yet" /> : <Hash value={o.witnessDigest} />)}</Val>
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
