"use client";

import { Button } from "@/components/ui";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-card border border-fault/30 bg-fault-bg p-8 text-center">
      <p className="font-serif text-h2">This page couldn&apos;t load its live data.</p>
      <p className="mt-2 text-sm text-ink-2">
        A read from the blockchain or the explorer failed. That&apos;s a problem on our side, not a refusal, and nothing is shown rather than a wrong
        number. It usually works on the next try.
      </p>
      <Button onClick={reset} variant="ghost" className="mt-5">
        Try again
      </Button>
    </div>
  );
}
