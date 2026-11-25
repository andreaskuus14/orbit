import { guard } from "@/lib/api-route";
import { requireUser } from "@/lib/supabase/server";
import { readActivity } from "@/lib/activity";
import { undoActivity } from "@/lib/activity-undo";
import { autopilotItems, cleanUndo, clipItems, goalItems, taskItems, type ActItem } from "@/lib/activity-pure";
import { listJobs, readState, studioRoot } from "@/lib/clips/factory";
import { readRecords } from "@/lib/time-machine";
import { dayOf, dayWindow, daysOf, isDay, timeline, TM_ID } from "@/lib/time-machine-pure";

export const dynamic = "force-dynamic";

// OPERATIONS → Time machine. GET ?day=YYYY-MM-DD (default today, Europe/Tallinn) → { day, days, entries }: everything ORBIT did that
// day (agent jobs, files, memory, settings, agent actions, sends), newest first, journal redacted to "Journal entry". Owner-only, no model.
async function GET_(req: Request) {
  const { sb, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams.get("day");
  const day = q && isDay(q) ? q : dayOf(new Date().toISOString());
  const w = dayWindow(day);
  const inDay = (xs: ActItem[]) => xs.filter((x) => dayOf(x.at) === day);
  const [log, recs, tasks, goals, jobs, auto, ledger, recent] = await Promise.all([
    readActivity().catch(() => []),
    readRecords().catch(() => []),
    sb.from("tasks").select("id, parent_id, agent, title, status, automation_id, error, trace, pending, created_at, started_at, finished_at")
      .gte("created_at", w.from).lte("created_at", w.to).order("created_at", { ascending: false }).limit(200).then((r) => taskItems(r.data ?? []), () => []),
    sb.from("goals").select("doc").order("updated_at", { ascending: false }).limit(30).then((r) => goalItems(r.data ?? []), () => []),
    listJobs().then(clipItems, () => []),
    readState<{ tracked?: { title: string; channel: string; at: string; auto: boolean }[] }>(studioRoot(), "autopilot", () => "", true) // keep: a read-only view never quarantines
      .then((a) => autopilotItems(Array.isArray(a?.tracked) ? a.tracked : []), () => []),
    sb.from("events").select("id, type, created_at, data").gte("created_at", w.from).lte("created_at", w.to).order("created_at", { ascending: false }).limit(1000).then((r) => r.data ?? [], () => []),
    sb.from("tasks").select("created_at").order("created_at", { ascending: false }).limit(500).then((r) => (r.data ?? []).map((x) => x.created_at as string), () => [] as string[]),
  ]);
  const items = [...inDay(log), ...inDay(tasks), ...inDay(goals), ...inDay(jobs), ...inDay(auto)];
  const days = daysOf([...log.map((x) => x.at), ...recs.map((r) => r.at), ...recent, new Date().toISOString()]);
  return Response.json({ day, days, entries: timeline(day, { items, recs, ledger }) });
}

// POST { tm: id } (a time-machine record: Undo, or Undo of the Undo) | { undo: ActUndo, area } (an Activity-log Undo).
async function POST_(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { tm?: unknown; undo?: unknown; area?: unknown } | null;
  const u = typeof b?.tm === "string" && TM_ID.test(b.tm) ? { kind: "tm" as const, id: b.tm } : cleanUndo(b?.undo);
  if (!u) return Response.json({ error: "Expected { tm: id } or { undo, area }" }, { status: 400 });
  const r = await undoActivity(sb, user.id, u, b?.area ?? "operator");
  return Response.json(r.body, { status: r.status });
}
export const GET = guard("time-machine", GET_);
export const POST = guard("time-machine", POST_);
