import type { ReactNode } from "react";

export function PageHead({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 border-b border-ink pb-6">
      <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-ink-2">{kicker}</p>
      <h1 className="font-serif text-3xl leading-tight tracking-tight sm:text-4xl">{title}</h1>
      {children ? <div className="mt-3 max-w-3xl text-[0.9375rem] leading-relaxed text-ink-2">{children}</div> : null}
    </header>
  );
}

export function Section({ title, id, children, note }: { title: string; id?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section id={id} className="mt-12" aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
        <h2 id={id ? `${id}-h` : undefined} className="font-serif text-2xl tracking-tight">
          {title}
        </h2>
        {note ? <p className="text-xs text-ink-2">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function AsOf({ block }: { block?: bigint }) {
  return (
    <p className="mt-6 text-xs text-ink-2">
      Read live from Arc Testnet{block !== undefined ? <> at block <span className="font-mono">{block.toString()}</span></> : null}. Snapshots are reused for up to 15 seconds.
    </p>
  );
}

export function Unavailable({ what, reason }: { what: string; reason: string }) {
  return (
    <div role="status" className="border border-dashed border-rule bg-paper-2 p-4 text-sm">
      <strong className="font-semibold">{what}: {reason}.</strong>{" "}
      <span className="text-ink-2">Nothing is shown rather than a guess. Reload in a few seconds; public Arc RPCs and the explorer occasionally throttle.</span>
    </div>
  );
}
