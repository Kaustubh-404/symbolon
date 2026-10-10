import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* ── Button ─────────────────────────────────────────────────────────────────────────── */

type Variant = "primary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold no-underline transition " +
  "duration-[var(--dur-micro)] ease-[var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 " +
  "disabled:active:scale-100";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/85 shadow-card",
  ghost: "border border-rule-strong/80 text-ink hover:bg-paper-2",
  danger: "bg-refused text-paper hover:bg-refused/85 shadow-card",
  quiet: "text-ink-2 hover:text-ink hover:bg-paper-2",
};
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-[0.8125rem]",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-6 text-[0.9375rem]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

function Spinner() {
  return <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  const external = href.startsWith("http");
  return external ? (
    <a href={href} className={buttonClass(variant, size, className)} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────────────────── */

export function Card({ children, className = "", as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "section" | "article" }) {
  return <As className={`rounded-card border border-rule bg-raised p-5 shadow-card sm:p-6 ${className}`}>{children}</As>;
}

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-kicker font-semibold uppercase tracking-[0.16em] text-ink-2 ${className}`}>{children}</p>;
}

/* ── Banner: info / ok / warn / error (state colours only) ──────────────────────────── */

type Tone = "info" | "ok" | "warn" | "fault" | "refused";
const tones: Record<Tone, string> = {
  info: "border-rule bg-paper-2 text-ink",
  ok: "border-released/40 bg-released-bg text-ink",
  warn: "border-wait/40 bg-wait-bg text-ink",
  fault: "border-fault/40 bg-fault-bg text-ink",
  refused: "border-refused/40 bg-refused-bg text-ink",
};

export function Banner({ tone = "info", title, children }: { tone?: Tone; title: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "fault" ? "alert" : "status"} className={`rounded-card border p-4 text-sm ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-ink-2">{children}</div> : null}
    </div>
  );
}

/* ── The seal: PAID / REFUSED / ESCALATED / HELD stamp (the signature element) ───────── */

export type SealKind = "paid" | "refused" | "escalated" | "held";
const sealTone: Record<SealKind, string> = {
  paid: "text-released border-released",
  refused: "text-refused border-refused",
  escalated: "text-wait border-wait",
  held: "text-ink-2 border-ink-2",
};
const sealWord: Record<SealKind, string> = { paid: "Paid", refused: "Refused", escalated: "Escalated", held: "Held" };

export function Seal({ kind, rule, note, animate = false, size = "md" }: { kind: SealKind; rule?: ReactNode; note?: ReactNode; animate?: boolean; size?: "sm" | "md" }) {
  return (
    <div
      role="img"
      aria-label={`${sealWord[kind]}${typeof rule === "string" ? `: ${rule}` : ""}`}
      className={`seal ${animate ? "seal-animate" : ""} inline-flex max-w-full flex-col rounded-[14px] border-[2.5px] ${sealTone[kind]} ${
        size === "sm" ? "px-3 py-1.5" : "px-5 py-3"
      } outline outline-1 outline-offset-[3px] outline-current/40`}
    >
      <span className={`font-serif font-semibold uppercase leading-none tracking-[0.14em] ${size === "sm" ? "text-base" : "text-[1.75rem]"}`}>
        {sealWord[kind]}
      </span>
      {rule ? <span className={`mt-1.5 font-sans font-semibold ${size === "sm" ? "text-[0.6875rem]" : "text-xs"} uppercase tracking-[0.08em]`}>{rule}</span> : null}
      {note ? <span className={`mt-0.5 ${size === "sm" ? "text-[0.6875rem]" : "text-xs"} text-ink-2`}>{note}</span> : null}
    </div>
  );
}

/* ── Stat ───────────────────────────────────────────────────────────────────────────── */

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "released" | "refused" }) {
  const color = tone === "released" ? "text-released" : tone === "refused" ? "text-refused" : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-kicker font-semibold uppercase tracking-[0.14em] text-ink-2">{label}</dt>
      <dd className={`mt-1.5 font-mono text-2xl tabular-nums tracking-tight ${color}`}>{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-ink-2">{note}</dd> : null}
    </div>
  );
}

/* ── Proof link: plain sentence first, raw evidence one click away ──────────────────── */

export function Proof({ href, children = "View proof" }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-[0.8125rem] font-medium text-ink-2 hover:text-ink">
      {children}
      <span aria-hidden>↗</span>
      <span className="sr-only">(opens the block explorer in a new tab)</span>
    </a>
  );
}

/* ── Empty state and skeletons ──────────────────────────────────────────────────────── */

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-rule p-8 text-center">
      <p className="font-serif text-h2">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`skeleton block ${className}`} />;
}

/* ── Chip ───────────────────────────────────────────────────────────────────────────── */

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "released" | "refused" | "wait" }) {
  const t = {
    neutral: "border-rule bg-paper-2 text-ink-2",
    released: "border-released/35 bg-released-bg text-released",
    refused: "border-refused/35 bg-refused-bg text-refused",
    wait: "border-wait/35 bg-wait-bg text-wait",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
