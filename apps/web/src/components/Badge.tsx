import type { ReactNode } from "react";

type Tone = "released" | "refused" | "neutral" | "human";

const tones: Record<Tone, string> = {
  released: "bg-released-bg text-released border-released/40",
  refused: "bg-refused-bg text-refused border-refused/40",
  neutral: "bg-paper-2 text-ink border-rule",
  human: "bg-paper-3 text-ink border-rule",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm border px-1.5 py-px text-[0.6875rem] font-semibold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (status === "Released") return "released";
  if (status === "Cancelled" || status === "Expired") return "refused";
  return "neutral";
}
