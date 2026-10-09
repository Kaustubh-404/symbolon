import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Proxies "Try it yourself" to the trial service on our server, keeping its token server-side. */
const API = process.env.TRIAL_API_URL;
const TOKEN = process.env.TRIAL_TOKEN;

export async function POST(req: Request) {
  if (!API || !TOKEN) return NextResponse.json({ error: "trials are not configured on this deployment" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { amountUsd?: unknown; note?: unknown };
  const r = await fetch(`${API}/trials`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-trial-token": TOKEN },
    body: JSON.stringify({ amountUsd: Number(body.amountUsd), note: String(body.note ?? "").slice(0, 500) }),
    cache: "no-store",
  });
  return NextResponse.json(await r.json(), { status: r.status });
}

export async function GET(req: Request) {
  if (!API) return NextResponse.json({ error: "trials are not configured on this deployment" }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^try-[a-z0-9]+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const r = await fetch(`${API}/trials/${id}`, { cache: "no-store" });
  return NextResponse.json(await r.json(), { status: r.status });
}
