// DREAM MODE, IO (rules: dream-pure.ts). One step of the sleep loop (sleep.ts): gathers the day's non-private items, scores the
// candidates (no model), asks the fast model for at most one call to word 3–5 connections (plain template lines when the usage
// pacer or the night's call cap says no), adds "suggested" MEMORY links between related memories, and keeps the report for the
// morning card. Every link is a time-machine record (Undo / redo) and an Activity line. State: <ORBIT data dir>/dream.json.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readStore, writeStore } from "./safe-file.ts";
import { orbitDataDir } from "./data-dir";
import { dropPrivate, PRIVATE_KIND_LIST } from "./private-pure";
import { fenceUntrusted } from "./reach/pure";
import { logActivity } from "./activity";
import { candidates, chooseConnections, dreamItems, dreamPrompt, DREAM_CONTEXT_MS, DREAM_FRESH_MS, DREAM_SYSTEM, linkKey, linksToMake, parseDream, parseDreamState,
  type DreamItem, type DreamReport, type DreamSignal, type DreamState } from "./dream-pure";
import { parseVec } from "./sleep-pure";

const file = () => path.join(orbitDataDir(), "dream.json");
const load = async (): Promise<DreamState> => parseDreamState(await readStore(file()));
const g = globalThis as unknown as { __orbitDream?: Promise<unknown> };
function update<T>(fn: (s: DreamState) => T): Promise<T> {
  const p = (g.__orbitDream ?? Promise.resolve()).catch(() => {}).then(async () => { const s = await load(), out = fn(s); await writeStore(file(), JSON.stringify(s)); return out; });
  g.__orbitDream = p;
  return p;
}

export const readDreamReport = async (userId: string) => (await load()).reports[userId];

const line = (s: unknown, n = 240) => (typeof s === "string" ? s.replace(/[#*_`>]/g, "").split(/\n+/).map((l) => l.trim()).find(Boolean)?.slice(0, n) ?? "" : "");
const enc = encodeURIComponent;

/** The day's items plus two weeks of context. Journal/LIFE rows are filtered in the query and again by dreamItems (fail closed). */
async function gather(sb: SupabaseClient, userId: string, now: number): Promise<{ items: DreamItem[]; linked: Set<string> }> {
  const fresh = new Date(now - DREAM_FRESH_MS).toISOString(), ctx = new Date(now - DREAM_CONTEXT_MS).toISOString();
  const isFresh = (at: string | null | undefined) => !!at && at >= fresh;
  const [mem, conv, proj, tasks, goals] = await Promise.all([
    sb.from("memories").select("id, kind, title, content, tags, created_at, embedding").eq("user_id", userId).not("kind", "in", PRIVATE_KIND_LIST)
      .not("kind", "in", "(conversation,episode)").gte("created_at", ctx).order("created_at", { ascending: false }).limit(140),
    sb.from("conversations").select("id, title, updated_at").eq("user_id", userId).gte("updated_at", fresh).order("updated_at", { ascending: false }).limit(20),
    sb.from("projects").select("id, name, description, updated_at").eq("user_id", userId).eq("status", "active").limit(20),
    sb.from("tasks").select("id, title, status, result, created_at, finished_at").eq("user_id", userId).is("parent_id", null).gte("created_at", fresh).limit(40),
    sb.from("goals").select("id, title, status, updated_at").eq("user_id", userId).in("status", ["approved", "running", "waiting", "blocked"]).limit(20),
  ]);
  if (mem.error) throw mem.error;
  const items: Partial<DreamItem>[] = [];
  for (const m of dropPrivate(mem.data)) items.push({ id: m.id, source: "memory", kind: m.kind, tags: m.tags ?? [], title: m.title, text: String(m.content ?? "").slice(0, 300),
    at: m.created_at, fresh: isFresh(m.created_at), embedding: parseVec(m.embedding), open: `#o=memory&k=memory&id=${enc(m.id)}` });
  for (const c of conv.data ?? []) if (c.title && c.title !== "New conversation") items.push({ id: `chat:${c.id}`, source: "chat", title: c.title, at: c.updated_at, fresh: true, open: "#o=core" });
  for (const p of proj.data ?? []) items.push({ id: `project:${p.id}`, source: "project", title: p.name, text: line(p.description), at: p.updated_at, fresh: isFresh(p.updated_at), open: "#o=operations" });
  for (const t of tasks.data ?? []) {
    const signal: DreamSignal | undefined = t.status === "done" ? "done" : ["failed", "awaiting_approval", "blocked"].includes(t.status) ? "open" : undefined;
    items.push({ id: `task:${t.id}`, source: "task", title: t.title, text: line(t.result), at: t.finished_at ?? t.created_at, fresh: true, signal, open: `#o=operations&k=task&id=${enc(t.id)}` });
  }
  for (const x of goals.data ?? []) items.push({ id: `goal:${x.id}`, source: "goal", title: x.title, at: x.updated_at, fresh: isFresh(x.updated_at), signal: x.status === "blocked" ? "open" : undefined, open: `#o=agents&k=goal&id=${enc(x.id)}` });
  // Shorts with a 48 h result in the last week, and video ideas from the last week (STUDIO's own files)
  await Promise.all([
    Promise.all([import("./clips/factory"), import("./clips/learn-pure")]).then(async ([f, l]) => {
      const learn = await f.readState<import("./clips/learn-pure").LearnState>(f.studioRoot(), "learn", l.learnProblem);
      for (const r of l.results48(Object.values(learn?.clips ?? {}))) if (r.title && now - Date.parse(r.capturedAt) < 7 * 86_400_000)
        items.push({ id: `short:${r.videoId}`, source: "short", title: r.title, at: r.capturedAt, fresh: isFresh(r.capturedAt), signal: r.verdict ?? undefined, open: "#o=studio" });
    }).catch(() => {}),
    import("./ideas").then(async (m) => {
      for (const i of (await m.listIdeas()).shown) if (i.at && now - Date.parse(i.at) < 7 * 86_400_000)
        items.push({ id: `idea:${i.id}`, source: "idea", title: i.title, text: line(i.summary, 200), at: i.at, fresh: isFresh(i.at), open: "#o=studio" });
    }).catch(() => {}),
  ]);
  const safe = dreamItems(items);
  const ids = safe.filter((i) => i.source === "memory").map((i) => i.id);
  const links = ids.length ? await sb.from("memory_links").select("from_id, to_id").eq("user_id", userId).in("from_id", ids).limit(2000) : { data: [] };
  return { items: safe, linked: new Set((links.data ?? []).map((l) => linkKey(l.from_id, l.to_id))) };
}

export type DreamAsk = (prompt: string, system: string) => Promise<string | null>;

/** One night's dream for one user. ask returns null when the call isn't allowed (pacer, Stop-all, the night's cap). Never throws. */
export async function dream(sb: SupabaseClient, userId: string, day: string, merged: number, ask: DreamAsk, now = Date.now()): Promise<DreamReport | null> {
  try {
    const { items, linked } = await gather(sb, userId, now);
    const cs = candidates(items, linked);
    if (!cs.length) return null;
    const text = await ask(dreamPrompt(cs, (label, t) => fenceUntrusted(label, t, 600)), DREAM_SYSTEM).catch(() => null);
    const model = parseDream(text, cs);
    const connections = chooseConnections(cs, model);
    const tm: string[] = [];
    let linkedN = 0;
    const { recordTm } = await import("./time-machine");
    for (const l of linksToMake(connections)) {
      const { data, error } = await sb.from("memory_links").insert({ user_id: userId, from_id: l.from, to_id: l.to, status: "suggested", score: 0.8, reason: l.reason }).select("id").single();
      if (error || !data) continue; // a race with another link: skip it
      const id = await recordTm({ title: "Dream mode linked two memories", why: l.reason.slice(0, 300), changes: [{ t: "link", id: data.id, before: null, after: { from: l.from, to: l.to, status: "suggested", reason: l.reason } }] });
      if (id) { tm.push(id); logActivity({ area: "core", title: "Dream mode linked two memories", detail: l.reason, undo: { kind: "tm", id } }); }
      linkedN++;
    }
    const report: DreamReport = { day, at: new Date(now).toISOString(), connections, linked: linkedN, merged, tm, by: model.length ? "model" : "plain" };
    await update((s) => { s.lastNight = day; s.reports[userId] = report; });
    return report;
  } catch (e) { console.error("[orbit] dream mode failed:", e instanceof Error ? e.message : e); return null; }
}

/** Adds the sleep loop's merges (time-machine ids) to today's report, so one Undo covers them too. */
export const addDreamRecords = (userId: string, ids: string[]) => ids.length ? update((s) => { const r = s.reports[userId]; if (r) r.tm = [...new Set([...r.tm, ...ids])]; }) : Promise.resolve();

/** "Undo tonight's changes": reverses every record of the report (newest first); the ones already undone are skipped. */
export async function undoDream(sb: SupabaseClient, userId: string): Promise<{ ok: boolean; undone: number; errors: string[] }> {
  const r = (await load()).reports[userId];
  if (!r || !r.tm.length) return { ok: false, undone: 0, errors: ["Nothing to undo"] };
  const { undoRecord } = await import("./time-machine");
  let undone = 0;
  const errors: string[] = [];
  for (const id of [...r.tm].reverse()) {
    const x = await undoRecord(sb, userId, id);
    if (x.ok) { undone++; logActivity({ area: "core", title: x.title, undid: `tm:${id}`, undo: { kind: "tm", id: x.id } }); }
    else if (x.status !== 409 || x.error !== "Already undone") errors.push(x.error);
  }
  await update((s) => { const cur = s.reports[userId]; if (cur) cur.undone = new Date().toISOString(); });
  return { ok: !errors.length, undone, errors };
}
