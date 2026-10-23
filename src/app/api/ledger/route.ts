import { requireUser } from "@/lib/supabase/server";
import { fromRows, isoMs, stateAt } from "@/lib/ledger-pure";

export const dynamic = "force-dynamic";

// GET /api/ledger?at=<ISO date-time> → the ledger snapshot at that moment (default now), from the owner's newest 5000 events up to it.
export async function GET(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams.get("at");
  const t = q === null ? Date.now() : isoMs(q);
  if (Number.isNaN(t)) return Response.json({ error: "at must be an ISO date-time with a zone" }, { status: 400 });
  // shortcut: newest 5000 only, so a long history undercounts; move to stored snapshots when the ledger outgrows it
  // "*" so reads work before 0016_ledger.sql adds caused_by
  const r = await sb.from("events").select("*").lte("created_at", new Date(t).toISOString()).order("created_at", { ascending: false }).limit(5000);
  if (r.error) return Response.json({ error: r.error.message }, { status: 500 });
  return Response.json({ at: new Date(t).toISOString(), snapshot: stateAt(fromRows(r.data ?? []), t) });
}
