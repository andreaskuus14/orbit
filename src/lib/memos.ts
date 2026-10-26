import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { createMemory } from "./memory";
import { cancelTask, kickQueue } from "./agents";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { readState, saveState, studioRoot } from "./clips/factory";
import { classifyMemo, filingFor, MEMO_SYSTEM, memoPrompt, parseModelKind, pushMemo, refiled, refileProblem, undoneMemo, undoProblem, type Memo, type MemoKind, type MemoRef } from "./memos-pure";

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
  if (r.sure || stopAllOn() || usageHold()) return { kind: r.kind, by: "rules" };
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

async function fileAs(sb: SupabaseClient, userId: string, kind: MemoKind, text: string): Promise<MemoRef> {
  const f = filingFor(kind, text);
  if (f.to === "task") { // same insert + queue kick as POST /api/tasks
    const { data, error } = await sb.from("tasks").insert({ user_id: userId, agent: "nova", title: f.title, request: f.request }).select("id").single();
    if (error) throw error;
    void kickQueue(sb, userId);
    return { to: "task", id: data.id };
  }
  const { memory } = await createMemory(sb, userId, { kind: f.kind, title: f.title, content: f.content, source: "voice-memo", tags: f.tags, folder: f.folder });
  return { to: "memory", id: memory.id };
}

async function unfile(sb: SupabaseClient, userId: string, ref: MemoRef) {
  if (ref.to === "task") {
    await cancelTask(sb, ref.id).catch(() => false);
    await sb.from("tasks").delete().eq("id", ref.id).neq("status", "running"); // a live run aborts and stays as "cancelled"
    return;
  }
  const { error } = await sb.from("memories").delete().eq("id", ref.id);
  if (error) throw error;
  await emit(sb, userId, "memory.deleted", "memory", { id: ref.id });
}

/** A transcript → classified, filed, stored. wav: the 16 kHz WAV, written to disk only when he ticked "keep audio". */
export async function fileMemo(sb: SupabaseClient, userId: string, text: string, source: Memo["source"], wav?: Uint8Array): Promise<Memo> {
  const { kind, by } = await classify(sb, userId, text);
  const ref = await fileAs(sb, userId, kind, text);
  const m: Memo = { id: randomUUID(), at: new Date().toISOString(), text, kind, by, source, ref };
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

export function refileMemo(sb: SupabaseClient, userId: string, id: string, kind: unknown): Promise<Memo | string> {
  return locked(async () => {
    const s = await load(), m = s.memos.find((x) => x.id === id);
    const why = refileProblem(m, kind);
    if (why || !m) return why;
    if (m.ref) await unfile(sb, userId, m.ref);
    const next = refiled(m, kind as MemoKind, await fileAs(sb, userId, kind as MemoKind, m.text));
    await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
    return next;
  });
}

export function undoMemo(sb: SupabaseClient, userId: string, id: string): Promise<Memo | string> {
  return locked(async () => {
    const s = await load(), m = s.memos.find((x) => x.id === id);
    const why = undoProblem(m);
    if (why || !m) return why;
    if (m.ref) await unfile(sb, userId, m.ref);
    const next = undoneMemo(m);
    await save({ memos: s.memos.map((x) => (x.id === id ? next : x)) });
    return next;
  });
}
