import { requireUser } from "@/lib/supabase/server";
import { addMissed, addWatch, checkNow, markChange, markWatch, removeWatch, watchBoard } from "@/lib/pagewatch";

export const dynamic = "force-dynamic";

// INTELLIGENCE → Watches (pagewatch.ts). GET: watches + recent changes. POST {action:"add", url, focus?, every?, purpose?, lead?}
// | {action:"remove"|"check"|"seen", id} | {action:"important", id, on: boolean}
// | {action:"verdict", id: changeId, verdict: "useful"|"noise"|null} | {action:"missed", id: watchId, note}. Local records; checks read public pages only.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json(await watchBoard()); } catch (e) { return fail(e instanceof Error ? e.message : "Couldn't read the watches", 500); }
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Array.isArray(b)) return fail("JSON body required");
  if (b.action === "add") { const r = await addWatch(b); return "error" in r ? fail(r.error) : Response.json(r); }
  const id = typeof b.id === "string" ? b.id.slice(0, 64) : "";
  if (!id) return fail("id required");
  if (b.action === "remove") return Response.json({ removed: await removeWatch(id) });
  if (b.action === "check") return (await checkNow(id)) ? Response.json({ ok: true }) : fail("Not checked (unknown watch, or Stop-all is on)");
  if (b.action === "seen") return Response.json({ ok: await markWatch(id, { seen: true }) });
  if (b.action === "important") return Response.json({ ok: await markWatch(id, { important: b.on === true }) });
  if (b.action === "verdict") {
    const v = b.verdict === "useful" || b.verdict === "noise" ? b.verdict : b.verdict === null ? null : undefined;
    return v === undefined ? fail("verdict must be useful, noise or null") : Response.json({ ok: await markChange(id, v) });
  }
  if (b.action === "missed") return Response.json({ ok: await addMissed(id, typeof b.note === "string" ? b.note : "") });
  return fail("action must be add, remove, check, seen, important, verdict or missed");
}
