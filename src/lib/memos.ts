import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { createMemory } from "./memory";
import { addReminder, removeReminder } from "./life";
import { MAX_BUGS, validateDevWorld, type DevWorld } from "./devworld-pure";
import { importDrafts } from "./backlog-pure";
import { duplicateOf, newCrm } from "./prospect-crm-pure";
import { loadCrm, updateCrm } from "./prospect-crm";
import { cancelTask, kickQueue } from "./agents";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { readState, saveState, studioRoot } from "./clips/factory";
import {
  classifyMemo, destOf, isPrivateText, DUMP_SYSTEM, dumpPrompt, filingFor, isDestId, itemFiling, itemFrom, itemRefileProblem, itemRefiled, itemStartProblem, itemUndoProblem, itemUndone, mergeModel, memoOfItems,
  MEMO_SYSTEM, memoPrompt, parseModelItems, parseModelKind, pickGame, planMemo, pushMemo, refiled, refileProblem, startProblem, undoneMemo, undoProblem, withItem,
  type Filing, type ItemKind, type ItemNote, type ItemRef, type Memo, type MemoItem, type MemoKind, type MemoRef, type Planned, type Target,
} from "./memos-pure";

// VOICE MEMOS store: <studio>/memos.json (local, like ideas.json); kept audio in <studio>/memos/<id>.wav. Logic: memos-pure.ts.
// Nothing here sends anything outward: memos become tasks (the AGENTS queue) or memories, like typing them in ORBIT would.
type Store = { memos: Memo[] };
const FILE = () => path.join(studioRoot(), "memos.json");
const AUDIO_DIR = () => path.join(studioRoot(), "memos");
const problem = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as Store).memos) ? "" : "no memos list");
const g = globalThis as unknown as { __orbitMemoQ?: Promise<unknown> };
/** One read-modify-write at a time: a re-file tapped while the next memo is filing mustn't lose either. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const p = (g.__orbitMemoQ ?? Promise.resolve()).then(fn, fn);
  g.__orbitMemoQ = p.catch(() => {});
  return p;
}
const load = async () => (await readState<Store>(studioRoot(), "memos", problem)) ?? { memos: [] };
const save = (s: Store) => saveState("memos", FILE(), s);
const dropAudio = (m: Memo) => (m.audio ? rm(path.join(AUDIO_DIR(), path.basename(m.audio)), { force: true }).catch(() => {}) : Promise.resolve());

export const listMemos = async (n = 20) => (await load()).memos.slice(0, n);

/** Rules first; one fast-model call only when they're unsure and nothing holds background spend. */
async function classify(sb: SupabaseClient, userId: string, text: string): Promise<{ kind: MemoKind; by: "rules" | "model" }> {
  const r = classifyMemo(text);
  if (r.sure || isPrivateText(text) || stopAllOn() || usageHold()) return { kind: r.kind, by: "rules" }; // private text never reaches the model
  try {
    const res = await askClaude(memoPrompt(text), MEMO_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 20_000, purpose: "memo.classify" });
    void recordUsage(sb, userId, "memo.classify", res, FAST_MODEL).catch(() => {});
    const k = parseModelKind(res.text);
    return k ? { kind: k, by: "model" } : { kind: r.kind, by: "rules" };
  } catch (e) {
    console.error("[memo] classify:", e instanceof Error ? e.message : e);
    return { kind: r.kind, by: "rules" };
  }
}

async function fileFiling(sb: SupabaseClient, userId: string, f: Filing): Promise<MemoRef> {
  if (f.to === "task") { // parked (see MEMO_TASK_NOTE): startMemo queues it
    const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: "nova", title: f.title, request: f.request, status: f.status, error: f.error }).select("id").single();
    if (error) throw error;
    return { to: "task", id: data.id };
  }
  const { memory } = await createMemory(sb, userId, { kind: f.kind, title: f.title, content: f.content, source: "voice-memo", tags: f.tags, folder: f.folder });
  return { to: "memory", id: memory.id };
}
const fileAs = (sb: SupabaseClient, userId: string, kind: MemoKind, text: string) => fileFiling(sb, userId, filingFor(kind, text));

/** A DevWorld read-modify-write with the same stale check as the dev-world API (and selene.ts): one retry when another tab changed it. */
async function editBacklog<T>(sb: SupabaseClient, fn: (w: DevWorld) => { world: DevWorld; out: T } | { out: T }): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb.from("game_saves").select("save, updated_at").eq("game", "devworld").maybeSingle();
    if (error || !data?.save) return null;
    const v = validateDevWorld(data.save);
    if (!v.ok) return null;
    const r = fn(v.world);
    if (!("world" in r)) return r.out;
    const w = await sb.from("game_saves").update({ save: r.world, updated_at: new Date().toISOString() }).eq("game", "devworld").eq("updated_at", data.updated_at).select("game");
    if (!w.error && w.data?.length) return r.out;
  }
  throw new Error("The backlog changed while saving");
}

type Filed = { ref: ItemRef | null; note?: ItemNote; game?: string };
type BugOut = { id?: string; note?: ItemNote; game?: string };
/** A note for a bug/feature that has no backlog to go to (no game matched, the list is full): kept as a memory he can file himself. */
const unfiledBug = (text: string, kind: ItemKind): Filing => {
  const f = filingFor("memory", text);
  return f.to === "memory" ? { ...f, tags: [...f.tags, "bug-to-file", kind], folder: "Game backlog (to file)" } : f;
};

/** One item → its planet through the existing create path. Whatever can't be filed there (no game, no lead name, no time) lands as a
 *  parked task or a note instead and says so in `note`: the words are never dropped. Journal text stays local (LIFE memory, no model). */
async function fileOne(sb: SupabaseClient, userId: string, kind: ItemKind, target: Target, text: string): Promise<Filed> {
  const f = itemFiling(kind, target, text, Date.now());
  switch (f.to) {
    case "bug": {
      const r = await editBacklog<BugOut>(sb, (w) => {
        const game = pickGame(w.games, text);
        if (!game) return { out: { note: "no-game" } };
        if (w.bugs.length >= MAX_BUGS) return { out: { note: "full", game: game.name } };
        const out = importDrafts(w, game.id, [f.draft], new Date().toISOString(), () => randomUUID());
        if (!out.added) return { out: { note: "duplicate", game: game.name } };
        return { world: out.world, out: { id: out.world.bugs[out.world.bugs.length - 1].id, game: game.name } };
      });
      if (r?.id) return { ref: { to: "bug", id: r.id }, game: r.game };
      if (r?.note === "duplicate") return { ref: null, note: "duplicate", game: r.game }; // already in the backlog: nothing new to undo
      return { ref: await fileFiling(sb, userId, unfiledBug(text, kind)), note: r?.note ?? "no-game", ...(r?.game && { game: r.game }) };
    }
    case "lead": {
      if (!f.name) return { ref: await fileFiling(sb, userId, f.fallback), note: "no-name" };
      const { data: all } = await sb.from("prospects").select("id,name,contact").limit(1000);
      if (duplicateOf(all ?? [], await loadCrm(), f.name, "")) return { ref: await fileFiling(sb, userId, f.fallback), note: "existing-lead" };
      const r = await sb.from("prospects").insert({ name: f.name, kind: "", contact: "", notes: f.notes }).select("id").single();
      if (r.error || !r.data) throw r.error ?? new Error("lead not saved");
      await updateCrm((s) => { s[r.data.id] = newCrm("manual", f.name!, ""); });
      await emit(sb, userId, "business.stage", "business", { prospect: r.data.id, to: "lead" });
      return { ref: { to: "prospect", id: r.data.id } };
    }
    case "reminder": {
      if (!f.at) return { ref: await fileFiling(sb, userId, f.fallback), note: "no-time" };
      const r = await addReminder(f.text, f.at);
      if ("error" in r) return { ref: await fileFiling(sb, userId, f.fallback), note: "failed" };
      return { ref: { to: "reminder", id: r.reminder.id } };
    }
    case "journal": {
      const { memory } = await createMemory(sb, userId, { kind: "journal", title: f.title, content: f.content, source: "voice-memo", tags: ["journal", "voice-memo"] }); // a failure stays a failure: never a searchable note
      await emit(sb, userId, "journal.saved", "life", { memoryId: memory.id });
      return { ref: { to: "memory", id: memory.id } };
    }
    default: return { ref: await fileFiling(sb, userId, f) };
  }
}

async function unfile(sb: SupabaseClient, userId: string, ref: ItemRef) {
  switch (ref.to) {
    case "task":
      await cancelTask(sb, ref.id).catch(() => false);
      await sb.from("tasks").delete().eq("id", ref.id).neq("status", "running"); // a live run aborts and stays as "cancelled"
      return;
    case "bug":
      await editBacklog(sb, (w) => (w.bugs.some((b) => b.id === ref.id) ? { world: { ...w, bugs: w.bugs.filter((b) => b.id !== ref.id) }, out: true } : { out: false }));
      return;
    case "prospect": {
      const { error } = await sb.from("prospects").delete().eq("id", ref.id);
      if (error) throw error;
      await updateCrm((s) => { delete s[ref.id]; }).catch(() => {});
      return;
    }
    case "reminder": await removeReminder(ref.id); return;
    case "memory": {
      const { error } = await sb.from("memories").delete().eq("id", ref.id);
      if (error) throw error;
      await emit(sb, userId, "memory.deleted", "memory", { id: ref.id });
    }
  }
}

/** One fast-model call for the whole memo, only for the parts the rules weren't sure about (never private ones: those are sure and local). */
async function splitWithModel(sb: SupabaseClient, userId: string, items: Planned[]): Promise<Planned[] | null> {
  const parts = items.filter((p) => !p.sure).map((p) => p.text);
  if (!parts.length || parts.some(isPrivateText) || stopAllOn() || usageHold()) return null; // belt and braces: private parts are always rule-sure
  try {
    const res = await askClaude(dumpPrompt(parts), DUMP_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 30_000, purpose: "memo.split" });
    void recordUsage(sb, userId, "memo.split", res, FAST_MODEL).catch(() => {});
    return parseModelItems(res.text, parts.join(" "));
  } catch (e) {
    console.error("[memo] split:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fileItems(sb: SupabaseClient, userId: string, items: Planned[]): Promise<MemoItem[]> {
  const model = await splitWithModel(sb, userId, items);
  const final = model ? mergeModel(items, model) : items;
  const out: MemoItem[] = [];
  for (const p of final) { // one after another: they share the backlog and the CRM store
    try { const f = await fileOne(sb, userId, p.kind, p.target, p.text); out.push(itemFrom(p, randomUUID(), f.ref, f.note, f.game)); }
    catch (e) {
      console.error("[memo] item:", p.kind, e instanceof Error ? e.message : e);
      out.push(itemFrom(p, randomUUID(), null, "failed"));
    }
  }
  return out;
}

/** A transcript → classified, filed, stored. wav: the 16 kHz WAV, written to disk only when he ticked "keep audio".
 *  One plain item: exactly as before. Several (a brain dump): one receipt with every item filed to its own place. */
export async function fileMemo(sb: SupabaseClient, userId: string, text: string, source: Memo["source"], wav?: Uint8Array): Promise<Memo> {
  const plan = planMemo(text);
  let m: Memo;
  if (plan.legacy && !isPrivateText(text)) { // private text always takes the item path: it is filed as a local journal entry
    const { kind, by } = await classify(sb, userId, text);
    const ref = await fileAs(sb, userId, kind, text);
    m = { id: randomUUID(), at: new Date().toISOString(), text, kind, by, source, ref };
  } else m = memoOfItems(randomUUID(), new Date().toISOString(), text, source, await fileItems(sb, userId, plan.items));
  if (wav) {
    await mkdir(AUDIO_DIR(), { recursive: true });
    await writeFile(path.join(AUDIO_DIR(), `${m.id}.wav`), wav);
    m.audio = `${m.id}.wav`;
  }
  await locked(async () => {
    const { list, dropped } = pushMemo((await load()).memos, m);
    await save({ memos: list });
    await Promise.all(dropped.map(dropAudio));
  });
  return m;
}

/** Re-file the memo (legacy) or one item of it (item = its id; dest = where to). */
export function refileMemo(sb: SupabaseClient, userId: string, id: string, kind: unknown, item?: string): Promise<Memo | string> {
  return locked(async () => {
    const s = await load(), m = s.memos.find((x) => x.id === id);
    if (m?.items) {
      const why = !item ? "Pick which item to change" : itemRefileProblem(m, item, kind);
      const cur = m.items.find((i) => i.id === item);
      if (why || !cur || !isDestId(kind)) return why;
      if (cur.ref) await unfile(sb, userId, cur.ref);
      const { kind: k, target } = destOf(kind), f = await fileOne(sb, userId, k, target, cur.text);
      const next = withItem(m, cur.id, (i) => itemRefiled(i, kind, f.ref, f.note, f.game));
      await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
      return next;
    }
    const why = refileProblem(m, kind);
    if (why || !m) return why;
    if (m.ref) await unfile(sb, userId, m.ref);
    const next = refiled(m, kind as MemoKind, await fileAs(sb, userId, kind as MemoKind, m.text));
    await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
    return next;
  });
}

/** Undo the memo (every item of a brain dump) or, with item, just that one. */
export function undoMemo(sb: SupabaseClient, userId: string, id: string, item?: string): Promise<Memo | string> {
  return locked(async () => {
    const s = await load(), m = s.memos.find((x) => x.id === id);
    if (m?.items) {
      const ids = item ? [item] : m.items.filter((i) => !i.undone).map((i) => i.id);
      let next = m;
      for (const iid of ids) {
        const why = itemUndoProblem(next, iid);
        if (why) { if (item) return why; continue; }
        const cur = next.items!.find((i) => i.id === iid)!;
        if (cur.ref) await unfile(sb, userId, cur.ref);
        next = withItem(next, iid, itemUndone);
        await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) }); // after each, so a failure halfway leaves the receipt true
      }
      if (!item && next === m) return "Already undone";
      return next;
    }
    const why = undoProblem(m);
    if (why || !m) return why;
    if (m.ref) await unfile(sb, userId, m.ref);
    const next = undoneMemo(m);
    await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
    return next;
  });
}

/** The owner's Start tap: queue the parked task (same update as the PC's Retry), then kick the queue. */
export function startMemo(sb: SupabaseClient, userId: string, id: string, item?: string): Promise<Memo | string> {
  return locked(async () => {
    const s = await load(), m = s.memos.find((x) => x.id === id);
    const cur = m?.items?.find((i) => i.id === item);
    const why = m?.items ? (item ? itemStartProblem(m, item) : "Pick which item to start") : startProblem(m);
    const ref = m?.items ? cur?.ref : m?.ref;
    if (why || !m || !ref) return why;
    const { data, error } = await sb.from("tasks").update({ status: "queued", error: null, started_at: null, finished_at: null }).eq("id", ref.id).eq("status", "cancelled").select("id");
    if (error) throw error;
    const next: Memo = m.items ? { ...m, items: m.items.map((i) => (i.id === item ? { ...i, started: true as const } : i)) } : { ...m, started: true };
    await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
    if (data?.length) void kickQueue(sb, userId);
    return next; // already started from the PC: just mark it
  });
}
