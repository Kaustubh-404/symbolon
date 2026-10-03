import { NextResponse } from "next/server";
import { CHAIN_ID, SYMBOLON } from "./config";
import { jsonSafe } from "./format";
import type { Loaded } from "./loaded";

/** A Loaded value as JSON: `{ value }` or `{ value: null, unavailable: reason }`. Never a stand-in 0. */
export function field<T>(l: Loaded<T>, f: (v: T) => unknown = (v) => v) {
  return l.ok ? { value: f(l.value) } : { value: null, unavailable: l.reason };
}

export function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(jsonSafe({ chainId: CHAIN_ID, contract: SYMBOLON, ...body }), {
    status,
    headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" },
  });
}
