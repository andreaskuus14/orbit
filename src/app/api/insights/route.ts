import { requireUser } from "@/lib/supabase/server";
import { actOnInsight, refreshInsights } from "@/lib/insights";

export const dynamic = "force-dynamic";

// CORE suggests: GET the visible suggestions (re-detected if older than a minute); POST { key, op: "dismiss"|"done"|"snooze", hours? }.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json({ items: (await refreshInsights(60_000)).slice(0, 10) }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Insights failed" }, { status: 500 }); }
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { key?: unknown; op?: unknown; hours?: unknown } | null;
  if (typeof b?.key !== "string" || b.key.length > 200 || !["dismiss", "done", "snooze"].includes(b.op as string)) return Response.json({ error: "key and op (dismiss, done or snooze) required" }, { status: 400 });
  const hours = typeof b.hours === "number" && Number.isFinite(b.hours) ? b.hours : undefined;
  if (!(await actOnInsight(b.key, b.op as "dismiss" | "done" | "snooze", hours))) return Response.json({ error: "Unknown suggestion" }, { status: 404 });
  return Response.json({ ok: true });
}
