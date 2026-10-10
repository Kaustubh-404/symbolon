import type { Metadata } from "next";
import { explorerAddress } from "@symbolon/sdk";
import { CHAIN_ID, CONTRACT_URL, DEPLOYMENT, GITHUB_URL, SOURCE_URL, SYMBOLON, USDC } from "@/lib/config";
import { duration, usd } from "@/lib/format";
import { getParams, ROLE_HOLDERS, ROLES } from "@/lib/reads";
import { Hash } from "@/components/Hash";
import { Val } from "@/components/Val";
import { PageHead, Section } from "@/components/Page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "How it's wired" };

export default async function ContractsPage() {
  const p = await getParams();

  const dur = (v: bigint) => duration(v).split(" (")[0];
  const params: Array<{ label: string; name: string; node: React.ReactNode; meaning: string }> = [
    { label: "Second signature above", name: "cosignThreshold", node: <Val l={p.cosignThreshold}>{usd}</Val>, meaning: "Bills above this need a person's second signature (NeedsCosign)." },
    { label: "Spending limit", name: "periodCap", node: <Val l={p.periodCap}>{usd}</Val>, meaning: "The most the AI can pay out per period (OverPeriodCap)." },
    { label: "Limit resets every", name: "periodLength", node: <Val l={p.periodLength}>{dur}</Val>, meaning: "Length of the spending-limit period." },
    { label: "Paid so far this period", name: "spentInPeriod", node: <Val l={p.spentInPeriod}>{usd}</Val>, meaning: "Counts against the spending limit." },
    { label: "New-wallet waiting period", name: "payeeCooldown", node: <Val l={p.payeeCooldown}>{dur}</Val>, meaning: "After a supplier's wallet changes, payments to it wait this long (PayeeChangedRecently)." },
    { label: "Grace after the due date", name: "grace", node: <Val l={p.grace}>{dur}</Val>, meaning: "After due date + grace a bill can't be paid (PastDue), and anyone may close it." },
    { label: "Payments paused", name: "paused", node: <Val l={p.paused}>{(v) => (v ? <span className="text-refused">Yes</span> : "No")}</Val>, meaning: "A guardian can pause; only the admin can restart." },
    { label: "Spare cash can only go to", name: "mintDeposit", node: <Val l={p.mintDeposit}>{(v) => <Hash value={v} href={explorerAddress(CHAIN_ID, v)} keep={4} />}</Val>, meaning: "Circle Mint, to be turned back into dollars. Nowhere else." },
  ];

  return (
    <>
      <PageHead kicker="How it's wired · Arc Testnet" title="Who can do what, and the limits the AI can't change">
        <p>
          Every limit and every key below is read from the contract right now. The source code is{" "}
          <a href={SOURCE_URL}>verified on Arcscan</a> and on <a href={`${GITHUB_URL}/blob/main/contracts/src/Symbolon.sol`}>GitHub</a>.
        </p>
      </PageHead>

      <Section title="Addresses" id="addresses">
        <div className="table-wrap rounded-card border border-rule bg-raised px-4 shadow-card sm:px-6">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Address</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="font-medium">Symbolon</th>
                <td><Hash value={SYMBOLON} href={CONTRACT_URL} /></td>
                <td className="text-ink-2">Verified. Deployed at block <span className="font-mono">{DEPLOYMENT.deployBlock}</span>.</td>
              </tr>
              <tr>
                <th scope="row" className="font-medium">USDC</th>
                <td><Hash value={USDC} href={explorerAddress(CHAIN_ID, USDC)} /></td>
                <td className="text-ink-2">The ERC-20 view of Arc&apos;s native USDC, 6 decimals. All accounting uses this view.</td>
              </tr>
              <tr>
                <th scope="row" className="font-medium">Mint deposit</th>
                <td><Hash value={DEPLOYMENT.mintDeposit} href={explorerAddress(CHAIN_ID, DEPLOYMENT.mintDeposit)} /></td>
                <td className="text-ink-2">Circle Mint sandbox deposit address on Arc.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="The keys, checked on-chain" id="roles" note="✓ means the contract confirms this key holds this role now">
        <div className="table-wrap rounded-card border border-rule bg-raised px-4 shadow-card sm:px-6">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Holder</th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="text-center">{r}</th>
                ))}
                <th scope="col">Duty</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_HOLDERS.map((h) => (
                <tr key={h.role}>
                  <th scope="row" className="font-mono text-xs font-medium">{h.role}</th>
                  <td><Hash value={h.address} href={explorerAddress(CHAIN_ID, h.address)} keep={4} /></td>
                  {ROLES.map((r) => {
                    const flag = p.roleMatrix[h.address]?.[r];
                    return (
                      <td key={r} className="text-center font-mono">
                        {!flag || !flag.ok ? (
                          <span className="text-xs italic text-ink-2" title={flag && !flag.ok ? flag.reason : "not read"}>?</span>
                        ) : flag.value ? (
                          <span className={r === h.role ? "text-released" : "text-refused"} aria-label="holds role">✓</span>
                        ) : (
                          <span className="text-ink-2" aria-label="does not hold role">·</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="min-w-[16rem] text-ink-2">{h.duty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-2">&ldquo;?&rdquo; means the read failed (RPC error), not that the role is absent.</p>
      </Section>

      <Section title="Why the AI can't overrule" id="sod">
        <div className="grid gap-6 text-[0.9375rem] leading-relaxed md:grid-cols-2">
          <p>
            The agent decides <em>whether, when and how</em> to pay. It cannot decide <em>what</em> is owed or{" "}
            <em>whether the money arrived</em>. Those halves come from keys the agent does not hold: the approver
            registers the document, the witness attests the funding. The contract refuses to grant the agent any of
            approver, witness, cosigner or admin, and refuses to grant those roles to the agent&apos;s address
            (<code className="font-mono">RoleConflict</code>). This is enforced in code, not by convention.
          </p>
          <p className="rounded-card border border-wait/40 bg-wait-bg p-4 text-ink-2">
            <strong className="text-ink">Stated plainly:</strong> on testnet all six keys are held by the team. Separation of duties is enforced
            on-chain between <em>keys</em>, not yet between people. The witness reads Circle&apos;s ledger, but Circle
            does not sign that response.
          </p>
        </div>
      </Section>

      <Section title="The limits" id="params" note="read live from the contract">
        <div className="table-wrap rounded-card border border-rule bg-raised px-4 shadow-card sm:px-6">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Limit</th>
                <th scope="col">Now</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {params.map((r) => (
                <tr key={r.name}>
                  <th scope="row" className="font-medium">
                    {r.label}
                    <span className="mt-0.5 block font-mono text-[0.6875rem] font-normal text-ink-2">{r.name}</span>
                  </th>
                  <td className="whitespace-nowrap font-mono tabular-nums">{r.node}</td>
                  <td className="text-ink-2">{r.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
