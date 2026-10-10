import type { ReactNode } from "react";
import { Chip } from "./ui";

type Tone = "released" | "refused" | "neutral" | "human";

/** Status chip. Kept for existing call sites; renders the shared Chip primitive. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <Chip tone={tone === "human" ? "wait" : tone}>{children}</Chip>;
}

export function statusTone(status: string): Tone {
  if (status === "Released") return "released";
  if (status === "Cancelled" || status === "Expired") return "refused";
  return "neutral";
}
