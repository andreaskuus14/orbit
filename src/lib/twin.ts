import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, emit, recordUsage, MODEL } from "./claude";
import { fromRows } from "./ledger-pure";
import { weeklyCap } from "./higgsfield-pure";
import { TWIN_SYSTEM, argueIntent, fallbackTwin, itemKey, parseDecision, parseState, parseTwin, pickEvidence, remember, setMuted, shouldArgue, twinPrompt, twinText, type Decision, type TwinKind, type TwinState, type TwinView } from "./twin-pure";

// ORBIT twin I/O (logic: twin-pure.ts). One model call per twin view, rule-based fallback on any failure.
// State: <ORBIT data dir>/twin.json (local: which items were argued, muted kinds). Ledger: twin.shown / twin.muted, ids only.

const file = () => path.join(orbitDataDir(), "twin.json");
const g = globalThis as unknown as { __orbitTwin?: Promise<unknown>; __orbitTwinRun?: Map<string, Promise<TwinView | null>> };

async function load(): Promise<TwinState> {
  const s = parseState(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("twin.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
function update<T>(fn: (s: TwinState) => T): Promise<T> {
  const p = (g.__orbitTwin ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitTwin = p;
  return p;
}

export const twinMuted = async () => (await load()).muted;
export async function muteTwin(sb: SupabaseClient, userId: string, kind: unknown, muted: unknown): Promise<string | null> {
  const err = await update((s) => setMuted(s, kind, muted));
  if (!err) await emit(sb, userId, "twin.muted", "core", { kind, muted });
  return err;
}

/** The twin for one decision, or null when the rules say stay quiet. Concurrent asks for the same item share one call. */
export function twinView(sb: SupabaseClient, userId: string, raw: unknown, signal?: AbortSignal): Promise<TwinView | null | string> {
  const d = parseDecision(raw);
  if (typeof d === "string") return Promise.resolve(d);
  const runs = (g.__orbitTwinRun ??= new Map()), key = itemKey(d);
  const run = runs.get(key) ?? argue(sb, userId, d, signal).finally(() => runs.delete(key));
  runs.set(key, run);
  return run;
}

/** His newest ledger events relevant to this kind, one line each (also the courtroom's ledger facts). */
export async function ledgerEvidence(sb: SupabaseClient, userId: string, kind: TwinKind) {
  const { data } = await sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 90 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(1000);
  return pickEvidence(kind, fromRows(data ?? []));
}

async function argue(sb: SupabaseClient, userId: string, d: Decision, signal?: AbortSignal): Promise<TwinView | null> {
  if (d.kind === "spend") d.cap = weeklyCap(process.env.ORBIT_HIGGSFIELD_WEEKLY_CAP); // his setting, not the page's
  const verdict = shouldArgue(d, await load(), Date.now(), process.env.ORBIT_TWIN_SPEND_MIN);
  if (!verdict.argue) return null;
  if (verdict.repeat) return verdict.repeat;
  const ev = await ledgerEvidence(sb, userId, d.kind);
  let view: TwinView | null = null;
  try {
    const r = await askClaude(twinPrompt(d, ev), TWIN_SYSTEM, { lane: "foreground", model: MODEL, timeoutMs: 45_000, purpose: "twin", signal });
    void recordUsage(sb, userId, "twin", r).catch(() => {});
    view = parseTwin(r.text, d, ev);
    if (!view) console.warn("[orbit] twin reply unusable; showing the fallback");
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("[orbit] twin model call failed; showing the fallback", e instanceof Error ? e.message : e);
  }
  view ??= fallbackTwin(d, ev);
  if (d.kind !== "argue") await update((s) => remember(s, view!, new Date().toISOString()));
  await emit(sb, userId, "twin.shown", "core", { kind: d.kind, ref: d.ref, fallback: view.fallback });
  return view;
}

/** CORE's "argue the other side": the twin on what the chat was just about (the previous turns), one model call. */
export async function argueReflex(sb: SupabaseClient, userId: string, question: string, history: { role: string; content: string }[], signal?: AbortSignal) {
  if (!argueIntent(question)) return null;
  const t = Date.now(), prev = history.slice(-5, -1);
  const topic = [...prev].reverse().find((h) => h.role === "user")?.content ?? history[history.length - 1].content;
  const v = await argue(sb, userId, { kind: "argue", ref: `chat-${t}`, title: topic.slice(0, 200), detail: prev.map((h) => `${h.role === "user" ? "Andreas" : "CORE"}: ${h.content}`).join("\n").slice(-2000) }, signal);
  if (!v) return null;
  return { text: twinText(v), citations: [], trace: [{ step: "reflex", detail: `twin · the case against${v.fallback ? " (fallback, no model)" : ""}`, ms: Date.now() - t, ok: true }], model: "smart" as const };
}
