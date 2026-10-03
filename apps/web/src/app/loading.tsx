export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="py-16 text-sm text-ink-2">
      <p className="font-serif text-xl text-ink">Reading the ledger…</p>
      <p className="mt-2">Scanning Symbolon&apos;s events on Arc Testnet in 9,000-block chunks. The first visit after a deploy can take a few seconds.</p>
    </div>
  );
}
