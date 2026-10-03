import type { ReactNode } from "react";
import type { Loaded } from "@/lib/loaded";

/** Render a Loaded value, or "unavailable (reason)" — never a silent 0. */
export function Val<T>({ l, children }: { l: Loaded<T>; children: (v: T) => ReactNode }) {
  if (l.ok) return <>{children(l.value)}</>;
  return <Unknown reason={l.reason} />;
}

export function Unknown({ reason }: { reason: string }) {
  return (
    <span className="font-sans text-sm italic text-ink-2" title="This value could not be read. It is not zero.">
      {reason}
    </span>
  );
}
