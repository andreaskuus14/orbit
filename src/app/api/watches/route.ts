import { requireUser } from "@/lib/supabase/server";
import { addWatch, checkNow, markWatch, removeWatch, watchBoard } from "@/lib/pagewatch";

export const dynamic = "force-dynamic";

// INTELLIGENCE → Watches (pagewatch.ts). GET: watches + recent changes. POST {action:"add", url, focus?, every?, purpose?, lead?}
// | {action:"remove"|"check"|"seen", id} | {action:"important", id, on: boolean}. Local records; checks read public pages only.
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
  return fail("action must be add, remove, check, seen or important");
}
