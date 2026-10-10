import type { ReactNode } from "react";
import { Kicker } from "./ui";

export function PageHead({ kicker, title, children, aside }: { kicker: string; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-10 grid gap-6 border-b border-rule pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="max-w-3xl">
        <Kicker className="mb-3">{kicker}</Kicker>
        <h1 className="font-serif text-h1 tracking-tight text-balance">{title}</h1>
        {children ? <div className="mt-4 space-y-2 text-[0.9375rem] leading-relaxed text-ink-2">{children}</div> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </header>
  );
}

export function Section({ title, id, children, note }: { title: string; id?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section id={id} className="mt-14 first:mt-0" aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id ? `${id}-h` : undefined} className="font-serif text-h2 tracking-tight">
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
    <p className="mt-8 text-xs text-ink-2">
      Read live from Arc Testnet{block !== undefined ? <> at block <span className="font-mono tabular-nums">{block.toString()}</span></> : null}. Refreshed every 15 seconds.
    </p>
  );
}

export function Unavailable({ what, reason }: { what: string; reason: string }) {
  return (
    <div role="status" className="rounded-card border border-fault/30 bg-fault-bg p-4 text-sm">
      <p className="font-semibold">
        {what} couldn&apos;t be read right now ({reason}).
      </p>
      <p className="mt-1 text-ink-2">We show nothing rather than a wrong number. Public Arc nodes sometimes throttle; reload in a few seconds.</p>
    </div>
  );
}
