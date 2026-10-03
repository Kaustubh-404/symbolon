/**
 * A value read from the chain or the explorer, or the reason it could not be read.
 * Nothing in this app renders a failed read as 0: an unknown is shown as "unavailable" with its reason.
 */
export type Loaded<T> = { ok: true; value: T } | { ok: false; reason: string };

export const RPC_ERROR = "unavailable (RPC error)";
export const EXPLORER_ERROR = "unavailable (explorer API error)";

export const ok = <T>(value: T): Loaded<T> => ({ ok: true, value });
export const fail = <T = never>(reason: string): Loaded<T> => ({ ok: false, reason });

export async function attempt<T>(fn: () => Promise<T>, reason: string = RPC_ERROR): Promise<Loaded<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    console.error(`[symbolon-web] ${reason}:`, e instanceof Error ? e.message.split("\n")[0] : e);
    return fail(reason);
  }
}

export function map<T, U>(l: Loaded<T>, f: (v: T) => U): Loaded<U> {
  return l.ok ? ok(f(l.value)) : l;
}
