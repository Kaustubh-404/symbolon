import { json } from "@/lib/api";
import { attempt, EXPLORER_ERROR } from "@/lib/loaded";
import { getRefusals } from "@/lib/refusals";

export const dynamic = "force-dynamic";

export async function GET() {
  const res = await attempt(getRefusals, EXPLORER_ERROR);
  if (!res.ok) return json({ refusals: null, unavailable: res.reason }, 503);
  return json({ count: res.value.refusals.length, scannedTxs: res.value.scannedTxs, truncated: res.value.truncated, refusals: res.value.refusals });
}
