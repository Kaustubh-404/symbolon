import { field, json } from "@/lib/api";
import { actionName, statusName, usdc } from "@/lib/format";
import { listObligations } from "@/lib/obligations";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await listObligations();
  if (!list.ok) return json({ obligations: null, unavailable: list.reason }, 503);
  return json({
    asOfBlock: list.value.head,
    count: list.value.rows.length,
    obligations: list.value.rows.map((r) => ({
      id: r.id,
      payeeId: r.payeeId,
      payee: r.payee,
      amount: { raw: r.amount, usdc: usdc(r.amount) },
      notBefore: r.notBefore,
      dueBy: r.dueBy,
      docHash: r.docHash,
      registered: { block: r.registeredBlock, tx: r.registeredTx },
      state: field(r.onchain, (o) => ({
        status: statusName(o.status),
        action: actionName(o.action),
        decidedBlock: o.decidedBlock,
        decisionHash: o.decisionHash,
        witnessDigest: o.witnessDigest,
        witnessedAmount: o.witnessedAmount,
        fundingRef: o.fundingRef,
        cosigned: o.cosigned,
      })),
    })),
  });
}
