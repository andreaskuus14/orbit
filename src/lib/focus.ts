// Time dilation, server glue (rules: dilation-pure.ts). State: <ORBIT data dir>/focus.json, cached on globalThis so the
// push and call paths can ask focusActive() synchronously. Ledger: focus.start / focus.end, ids and minutes only.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { FOCUS_START, holdPush, isFocusActive, newFocus, parseFocusState, passesFocus, summarize, type FocusState } from "./dilation-pure";
import type { PushMessage } from "./remote-push-pure";

const file = () => path.join(orbitDataDir(), "focus.json");
const g = globalThis as unknown as { __orbitFocus?: FocusState; __orbitFocusSave?: Promise<unknown>; __orbitFocusTimer?: NodeJS.Timeout };

export function focusState(): FocusState {
  if (!g.__orbitFocus) { try { g.__orbitFocus = parseFocusState(readFileSync(file(), "utf8")); } catch { g.__orbitFocus = FOCUS_START; } }
  return g.__orbitFocus;
}

/** Serialized change → memory at once → atomic save (same pattern as autonomy.ts). fn returns a string to refuse. */
function update(fn: (s: FocusState) => FocusState | string): Promise<FocusState | string> {
  const p = (g.__orbitFocusSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(structuredClone(focusState()));
    if (typeof next === "string") return next;
    g.__orbitFocus = next;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next));
    await rename(file() + ".tmp", file());
    return next;
  });
  g.__orbitFocusSave = p;
  return p;
}

/** The shared check for every ORBIT notification path. A block that ran out is ended (summary + release) in the background. */
export function focusActive(now = Date.now()): boolean {
  const f = focusState().focus;
  if (f && !isFocusActive(f, now)) void import("./supabase/admin").then((a) => endFocus(a.adminClient(), f.id)).catch(() => {});
  return isFocusActive(f, now);
}

/** deliver()'s hook: true = held for the end of the block (the caller sends nothing now). Urgent kinds always pass. */
export function heldForFocus(msg: PushMessage): boolean {
  if (passesFocus(msg.tag) || !focusActive()) return false;
  void update((s) => (s.focus ? { ...s, held: holdPush(s.held, msg) } : "ended")).catch(() => {});
  return true;
}

export async function startFocus(sb: SupabaseClient, userId: string, minutes: unknown, goal: unknown) {
  const now = Date.now();
  const f = newFocus(minutes, goal, now, randomUUID());
  if (typeof f === "string") return f;
  const r = await update((s) => (isFocusActive(s.focus, now) ? "A focus block is already running" : { focus: f, userId, held: s.held, last: null }));
  if (typeof r === "string") return r;
  clearTimeout(g.__orbitFocusTimer);
  g.__orbitFocusTimer = setTimeout(() => void import("./supabase/admin").then((a) => endFocus(a.adminClient(), f.id)).catch(() => {}), f.endAt - now + 1000);
  g.__orbitFocusTimer.unref?.();
  const { emit } = await import("./claude");
  await emit(sb, userId, "focus.start", "life", { focus: f.id, minutes: f.minutes });
  return r;
}

/** End the block (time up or his "End now"): summary of the window, ledger, then the held pushes go out. Idempotent per id. */
export async function endFocus(sb: SupabaseClient | null, id?: string): Promise<FocusState> {
  const s0 = focusState(), f = s0.focus;
  if (!f || (id && f.id !== id)) return s0;
  const now = Date.now();
  // What agents did while he focused: event types and counts only (shortcut: newest 1000 rows; a busier block undercounts).
  const rows = sb && s0.userId ? (await sb.from("events").select("type, payload").eq("user_id", s0.userId).gte("created_at", new Date(f.startAt).toISOString()).lte("created_at", new Date(now).toISOString()).limit(1000)).data ?? [] : [];
  let held: FocusState["held"] = [], userId = "";
  const r = await update((s) => {
    if (s.focus?.id !== f.id) return "gone"; // ended meanwhile (another window, the timer)
    held = s.held; userId = s.userId;
    return { focus: null, userId: s.userId, held: [], last: summarize(f, s.held, rows, now) };
  });
  if (typeof r === "string") return focusState();
  clearTimeout(g.__orbitFocusTimer);
  if (sb && userId) {
    const { emit } = await import("./claude");
    await emit(sb, userId, "focus.end", "life", { focus: f.id, minutes: r.last!.actual });
  }
  const { deliver, pushProblem } = await import("./remote-push");
  if (!pushProblem()) for (const h of held) await deliver(h.msg);
  return r;
}

export const dismissSummary = () => update((s) => ({ ...s, last: null }));
