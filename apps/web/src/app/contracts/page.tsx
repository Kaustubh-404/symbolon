import type { Metadata } from "next";
import { explorerAddress } from "@symbolon/sdk";
import { CHAIN_ID, CONTRACT_URL, DEPLOYMENT, GITHUB_URL, SOURCE_URL, SYMBOLON, USDC } from "@/lib/config";
import { duration, usdc } from "@/lib/format";
import { getParams, ROLE_HOLDERS, ROLES } from "@/lib/reads";
import { Hash } from "@/components/Hash";
import { Val } from "@/components/Val";
import { PageHead, Section } from "@/components/Page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const p = await getParams();

  const params: Array<{ name: string; node: React.ReactNode; meaning: string }> = [
    { name: "cosignThreshold", node: <Val l={p.cosignThreshold}>{(v) => `${usdc(v)} USDC`}</Val>, meaning: "Above this, a human cosigner must sign (NeedsCosign)." },
    { name: "periodCap", node: <Val l={p.periodCap}>{(v) => `${usdc(v)} USDC`}</Val>, meaning: "Most the agent can release per period (OverPeriodCap)." },
    { name: "periodLength", node: <Val l={p.periodLength}>{duration}</Val>, meaning: "Length of the budget period." },
    { name: "spentInPeriod(now)", node: <Val l={p.spentInPeriod}>{(v) => `${usdc(v)} USDC`}</Val>, meaning: "Released so far in the current period." },
    { name: "payeeCooldown", node: <Val l={p.payeeCooldown}>{duration}</Val>, meaning: "After a payee's wallet changes, payments wait this long (PayeeChangedRecently)." },
    { name: "grace", node: <Val l={p.grace}>{duration}</Val>, meaning: "After dueBy + grace a bill can no longer be paid (PastDue) and anyone may expire it." },
    { name: "paused", node: <Val l={p.paused}>{(v) => (v ? <span className="text-refused">paused</span> : "no")}</Val>, meaning: "A guardian can pause; only the admin can unpause." },
    { name: "mintDeposit", node: <Val l={p.mintDeposit}>{(v) => <Hash value={v} href={explorerAddress(CHAIN_ID, v)} />}</Val>, meaning: "The only address surplus may ever be redeemed to (Circle Mint deposit)." },
  ];

  return (
    <>
      <PageHead kicker="Arc Testnet · chain 5042002" title="Contracts and roles">
        Addresses come from the deployment record in the SDK; every parameter and role flag below is read from the
        contract now. Source is <a href={SOURCE_URL}>verified on Arcscan</a> and in{" "}
        <a href={`${GITHUB_URL}/blob/main/contracts/src/Symbolon.sol`}>contracts/src/Symbolon.sol</a>.
      </PageHead>

      <Section title="Addresses" id="addresses">
        <div className="table-wrap">
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

      <Section title="Roles, checked on-chain" id="roles" note="✓ = hasRole(role, address) is true right now">
        <div className="table-wrap">
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

      <Section title="Separation of duties" id="sod">
        <div className="grid gap-6 text-[0.9375rem] leading-relaxed md:grid-cols-2">
          <p>
            The agent decides <em>whether, when and how</em> to pay. It cannot decide <em>what</em> is owed or{" "}
            <em>whether the money arrived</em>. Those halves come from keys the agent does not hold: the approver
            registers the document, the witness attests the funding. The contract refuses to grant the agent any of
            approver, witness, cosigner or admin, and refuses to grant those roles to the agent&apos;s address
            (<code className="font-mono">RoleConflict</code>). This is enforced in code, not by convention.
          </p>
          <p className="text-ink-2">
            Caveat, stated plainly: on testnet all six keys are held by the team. Separation of duties is enforced
            on-chain between <em>keys</em>, not yet between people. The witness reads Circle&apos;s ledger, but Circle
            does not sign that response.
          </p>
        </div>
      </Section>

      <Section title="Parameters" id="params" note="read live">
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Value</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {params.map((r) => (
                <tr key={r.name}>
                  <th scope="row" className="font-mono text-xs font-medium">{r.name}</th>
                  <td className="whitespace-nowrap font-mono">{r.node}</td>
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
