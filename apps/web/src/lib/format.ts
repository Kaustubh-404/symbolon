import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@symbolon/sdk";

/** USDC from the ERC-20 view: 6 decimals, always shown in full, with thousands separators. */
export function usdc(amount: bigint): string {
  const [whole = "0", frac = ""] = formatUnits(amount, USDC_DECIMALS).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return `${grouped}.${frac.padEnd(USDC_DECIMALS, "0")}`;
}

export function utc(unixSeconds: bigint | number): string {
  const d = new Date(Number(unixSeconds) * 1000);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function duration(seconds: bigint | number): string {
  const s = Number(seconds);
  if (s % 86_400 === 0) return `${s / 86_400} day${s === 86_400 ? "" : "s"} (${s.toLocaleString("en-US")} s)`;
  if (s % 3_600 === 0) return `${s / 3_600} h (${s.toLocaleString("en-US")} s)`;
  return `${s.toLocaleString("en-US")} s`;
}

export const STATUS = ["None", "Registered", "Released", "Cancelled", "Expired"] as const;
export const ACTION = ["None", "Pay", "Hold", "Escalate"] as const;
export type StatusName = (typeof STATUS)[number];

export function statusName(n: number): StatusName | "Unknown" {
  return STATUS[n] ?? "Unknown";
}

export function actionName(n: number): string {
  return ACTION[n] ?? `Unknown(${n})`;
}

export const ZERO_HASH = `0x${"0".repeat(64)}` as const;
export const isZeroHash = (h: string) => /^0x0*$/.test(h);

/** JSON with bigints as decimal strings (for the API routes). */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** Display dollars for people: "$5.35", "$0.10", "$1,250"; sub-cent amounts keep their digits ("$0.0042"). */
export function usd(amount: bigint): string {
  const [whole = "0", frac = ""] = formatUnits(amount, USDC_DECIMALS).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const f = frac.replace(/0+$/, "");
  if (!f) return `$${grouped}`;
  return `$${grouped}.${f.length <= 2 ? f.padEnd(2, "0") : f}`;
}

/** "2026-10-04 13:24 UTC" from an ISO string (keeps sentences readable). */
export function isoToUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}
