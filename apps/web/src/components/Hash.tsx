"use client";

import { useState } from "react";

type Props = {
  value: string;
  /** explorer link for the value, if any */
  href?: string;
  /** characters kept at each end (after 0x) */
  keep?: number;
  className?: string;
};

export function short(value: string, keep = 6) {
  if (!value.startsWith("0x") || value.length <= keep * 2 + 4) return value;
  return `${value.slice(0, keep + 2)}…${value.slice(-4)}`;
}

/** A shortened hash. Click to copy the full value; the full value is always in the title. */
export function Hash({ value, href, keep = 6, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard blocked: the full value is still in the title attribute
    }
  }

  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap font-mono text-[0.8125rem] ${className}`}>
      <button
        type="button"
        onClick={copy}
        title={value}
        aria-label={`Copy ${value}`}
        className="cursor-copy rounded-sm px-0.5 text-ink decoration-dotted underline-offset-2 hover:bg-paper-3 hover:underline"
      >
        {short(value, keep)}
      </button>
      <span aria-live="polite" className="text-[0.6875rem] text-ink-2">
        {copied ? "copied" : ""}
      </span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={`Open ${value} on the explorer`} className="text-ink-2 no-underline hover:text-ink" aria-label="Open on explorer">
          ↗
        </a>
      ) : null}
    </span>
  );
}
