import { field, json } from "@/lib/api";
import { usdc } from "@/lib/format";
import { getStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

const amount = (v: bigint) => ({ raw: v, usdc: usdc(v) });

export async function GET() {
  const s = await getStats();
  return json({
    asOfBlock: field(s.head),
    obligationsRegistered: field(s.obligationsRegistered),
    releasedCount: field(s.releasedCount),
    totalReleased: field(s.totalReleased, amount),
    refusalsMined: field(s.refusalsMined),
    vaultBalance: field(s.vaultBalance, amount),
    reserved: field(s.reserved, amount),
    surplus: field(s.surplus, amount),
    notes: "Amounts: raw = USDC base units (6 decimals, ERC-20 view). A null value with `unavailable` means the read failed; it is not zero.",
  });
}
