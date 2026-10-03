/**
 * Process-local cache with in-flight de-duplication. Only successful results are cached, so a failed read is
 * retried on the next request instead of being pinned for the TTL. On Vercel each warm instance keeps its own copy.
 */
type Entry = { at: number; value: unknown };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
