// Chronicle IO: gathers stored data (RLS-scoped, in parallel; a failing source counts as nothing) for chronicle-pure.ts, and the
// arc titles: at most one FAST_MODEL call per finished month, ever (claimed before the call), never with private moments.
// State: <ORBIT data dir>/chronicle-titles.json = {months: {"YYYY-MM": {at, titles: {week: title}}}}.
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRows, type EventRow } from "./ledger-pure";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { orbitDataDir } from "./data-dir";
import { usageHold } from "./usage-meter";
import { stopAllOn } from "./stop-all";
import { ARC_SYSTEM, arcPrompt, buildChronicle, monthArcs, parseArcTitles, titleableMonths, type ChronIn, type Chronicle } from "./chronicle-pure";

const TYPES = ["goal.step", "clip.outcome48h", "clip.published", "business.stage", "night.end", "deal.found", "lesson.kept", "focus.session", "journal.saved"];
type Titles = { months: Record<string, { at: string; titles: Record<string, string> }> };
const file = () => path.join(orbitDataDir(), "chronicle-titles.json");
const load = async (): Promise<Titles> => {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.months && typeof j.months === "object" ? j : { months: {} }; } catch { return { months: {} }; }
};
async function store(s: Titles) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}
const allTitles = (t: Titles) => Object.assign({}, ...Object.values(t.months).map((m) => m.titles)) as Record<string, string>;

export async function gather(sb: SupabaseClient, userId: string, includePrivate: boolean, now: number): Promise<ChronIn> {
  const rows = <T>(p: PromiseLike<{ data: T[] | null }>) => Promise.resolve(p).then((r) => r.data ?? [], () => [] as T[]);
  let mem = sb.from("memories").select("id, title, kind, tags, source, created_at").eq("user_id", userId);
  if (!includePrivate) mem = mem.neq("kind", "journal"); // journal rows are not even read unless he asked for them
  const [events, memories, goals, jobs, dev] = await Promise.all([
    // shortcut: newest 5000 events / 3000 memories; page through when the history outgrows it
    rows<EventRow>(sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", TYPES).order("created_at", { ascending: false }).limit(5000)),
    rows<{ id: string; title: string; kind: string; tags: string[] | null; source: string | null; created_at: string }>(mem.order("created_at", { ascending: false }).limit(3000)),
    import("./goals").then((g) => g.listGoals(sb, userId), () => []),
    import("./clips/factory").then((f) => f.listJobs(), () => []),
    import("./dev-session").then((d) => d.listDevSessions(sb, userId), () => []),
  ]);
  return {
    now, includePrivate, events: fromRows(events.reverse()),
    memories: memories.map((m) => ({ ...m, title: m.title ?? "", tags: m.tags ?? [] })),
    goals: goals.map((r) => ({ id: r.id, title: r.doc.title, status: r.doc.status, updatedAt: r.updated_at, steps: r.doc.steps.map((s) => ({ id: s.id, what: s.what })) })),
    clips: jobs.flatMap((j) => j.clips.map((c) => ({ job: j.id, id: c.id, title: c.publish?.title ?? c.title, ...(c.publish?.status === "done" ? { publishedAt: c.publish.at } : {}) }))),
    dev: dev.map((s) => ({ id: s.id, start: s.start, line: `Roblox dev · ${s.line}` })),
  };
}

export async function getChronicle(sb: SupabaseClient, userId: string, includePrivate: boolean, now = Date.now()): Promise<Chronicle & { untitled: string[] }> {
  const [x, t] = await Promise.all([gather(sb, userId, includePrivate, now), load()]);
  const c = buildChronicle(x, allTitles(t));
  return { ...c, untitled: titleableMonths(c, now, Object.keys(t.months)) };
}

/** Titles one finished month's arcs with the fast model, at most once per month (also when the call fails). */
export async function titleMonth(sb: SupabaseClient, userId: string, month: string, now = Date.now()): Promise<Record<string, string>> {
  const t = await load();
  if (t.months[month] || stopAllOn() || usageHold()) return t.months[month]?.titles ?? {};
  const c = buildChronicle(await gather(sb, userId, false, now)); // never private: the prompt is built without journal rows at all
  if (!titleableMonths(c, now, Object.keys(t.months)).includes(month)) return {};
  t.months[month] = { at: new Date(now).toISOString(), titles: {} };
  await store(t); // claimed before the call: a crash or failure can't make it run twice
  const r = await askClaude(arcPrompt(c, month), ARC_SYSTEM, { lane: "background", model: FAST_MODEL, timeoutMs: 60_000, purpose: "chronicle.arcs" }).catch(() => null);
  if (!r) return {};
  void recordUsage(sb, userId, "chronicle.arcs", r, FAST_MODEL).catch(() => {});
  const titles = parseArcTitles(r.text, monthArcs(c, month).map((a) => a.week));
  const fresh = await load();
  fresh.months[month] = { at: new Date(now).toISOString(), titles };
  await store(fresh);
  return titles;
}
