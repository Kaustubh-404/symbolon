"use client";

import { useState } from "react";

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
    <div className="mt-4">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="border border-ink bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-refused disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Sending to Arc…" : "Try it — send the transaction"}
      </button>
      <div aria-live="polite" className="mt-3 text-sm">
        {r?.error ? <p className="text-ink-2">{r.error}</p> : null}
        {r?.tx ? (
          <div className="border-l-4 border-refused bg-refused-bg p-3">
            <p className="font-semibold text-refused">
              Refused on-chain: <span className="font-mono">{r.refusal}</span>
              {r.matchedExpectation ? "" : ` (expected ${expect})`}
            </p>
            <p className="mt-1 text-ink">{r.explanation}</p>
            <p className="mt-2 text-xs text-ink-2">
              Mined in block <span className="font-mono">{r.block}</span> with status <span className="font-mono">{r.status}</span>.{" "}
              <a href={r.txUrl} target="_blank" rel="noreferrer">
                See it on the explorer ↗
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
