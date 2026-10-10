import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Reading live data from Arc">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-4 h-10 w-full max-w-xl" />
      <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      <Skeleton className="mt-2 h-4 w-3/4 max-w-xl" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full !rounded-[var(--radius-card)]" />
        ))}
      </div>
      <p className="mt-6 text-sm text-ink-2">Reading live data from Arc… the first visit after a quiet spell can take a few seconds.</p>
    </div>
  );
}
