"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="py-16">
      <p className="font-serif text-2xl">This page could not be read.</p>
      <p className="mt-2 text-sm text-ink-2">A chain or explorer read failed. No value is shown rather than a wrong one.</p>
      <button type="button" onClick={reset} className="mt-4 border border-ink px-3 py-1 text-sm hover:bg-paper-2">
        Try again
      </button>
    </div>
  );
}
