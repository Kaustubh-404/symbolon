"use client";

import { useState } from "react";
import { ruleLabel, shortenInText } from "@/lib/rules";
import { Banner, Button, Proof, Seal } from "@/components/ui";

type Result = {
  tx?: string;
  txUrl?: string;
  block?: string;
  status?: string;
  refusal?: string;
  explanation?: string;
  matchedExpectation?: boolean;
  error?: string;
};

export function BreakButton({ scenario, expect }: { scenario: string; expect: string }) {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Result | null>(null);

  async function go() {
    setBusy(true);
    setR(null);
    try {
      const res = await fetch(`/api/break-it/${scenario}`, { method: "POST" });
      setR((await res.json()) as Result);
    } catch (e) {
      setR({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-auto pt-5">
      <Button variant={r?.tx ? "ghost" : "primary"} loading={busy} onClick={go} className="w-full sm:w-auto">
        {busy ? "Sending to Arc…" : r?.tx ? "Try again" : "Try it — send the transaction"}
      </Button>
      <div aria-live="polite">
        {r?.error ? (
          <div className="mt-4">
            <Banner tone={r.error.startsWith("rate limited") ? "info" : "fault"} title={r.error.startsWith("rate limited") ? "One moment." : "That didn't go through."}>
              {r.error}
            </Banner>
          </div>
        ) : null}
        {r?.tx ? (
          <div className="mt-5 rounded-[12px] border border-refused/30 bg-refused-bg p-4">
            <Seal kind="refused" size="sm" animate rule={`Rule: ${ruleLabel(r.refusal ?? expect)}`} note="No money moved." />
            <p className="mt-3 text-sm text-ink" title={r.explanation}>{shortenInText(r.explanation ?? "")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
              <Proof href={r.txUrl!}>See the refused transaction</Proof>
              <span>
                block <span className="font-mono tabular-nums">{r.block}</span> · <span className="font-mono">{r.refusal}</span>
                {r.matchedExpectation ? "" : ` (expected ${expect})`}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
