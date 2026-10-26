// Time dilation: a focus block (25/50/90 min, one goal). While it runs the galaxy slows, ORBIT's pushes, calls and bell
// notices are held (urgent ones pass), agents keep working; at the end a "while you were focused" summary, then the held
// items go out. Pure; tested in tests/dilation.test.ts. Server glue: focus.ts; route: /api/focus; UI: TimeDilation.tsx.
import type { PushKind, PushMessage } from "./remote-push-pure.ts";

export const FOCUS_BLOCKS = [25, 50, 90] as const;
export type FocusBlock = typeof FOCUS_BLOCKS[number];
export type Focus = { id: string; minutes: FocusBlock; goal: string; startAt: number; endAt: number };
export type HeldPush = { tag: PushKind; n: number; msg: PushMessage };
export type WorkLine = { label: string; n: number };
export type FocusSummary = { id: string; goal: string; minutes: FocusBlock; actual: number; held: { tag: PushKind; n: number }[]; work: WorkLine[] };
export type FocusState = { focus: Focus | null; userId: string; held: HeldPush[]; last: FocusSummary | null };
export const FOCUS_START: FocusState = { focus: null, userId: "", held: [], last: null };
export const GOAL_MAX = 140;

/** The one "is focus active" rule, shared by the server (pushes, calls) and the client (bell, galaxy). */
export const isFocusActive = (f: Pick<Focus, "startAt" | "endAt"> | null | undefined, now: number) => !!f && now >= f.startAt && now < f.endAt;

export function newFocus(minutes: unknown, goal: unknown, now: number, id: string): Focus | string {
  if (!FOCUS_BLOCKS.includes(minutes as FocusBlock)) return "Pick 25, 50 or 90 minutes";
  const g = typeof goal === "string" ? goal.replace(/\s+/g, " ").trim() : "";
  if (!g) return "Name the one goal for this block";
  return { id, minutes: minutes as FocusBlock, goal: g.slice(0, GOAL_MAX), startAt: now, endAt: now + (minutes as number) * 60_000 };
}

// The pushes deliver() already sends with Urgency: high. Calls are filtered earlier (call-pure: only "urgent" rings in focus).
export const FOCUS_PASS: readonly PushKind[] = ["failed", "stop", "call"];
export const passesFocus = (tag: PushKind) => FOCUS_PASS.includes(tag);

/** Hold one push: coalesced per kind, the latest message kept (its label already carries the newest counts). */
export function holdPush(held: HeldPush[], msg: PushMessage): HeldPush[] {
  const i = held.findIndex((h) => h.tag === msg.tag);
  return i < 0 ? [...held, { tag: msg.tag, n: 1, msg }] : held.map((h, j) => (j === i ? { tag: h.tag, n: h.n + 1, msg } : h));
}

// Ledger rows that count as "agents did something" while he focused. Labels only: never titles, text or payload contents.
const WORK: Record<string, string> = {
  "task.delivered": "agent tasks delivered", "pulse.completed": "briefings written", "proposal.created": "proposals made",
  "autonomy.act": "auto actions taken", "clip.published": "Shorts published", "deal.found": "deals found",
  "pulse.failed": "briefings failed",
};
const NIGHT: Record<string, string> = { done: "night-shift tasks done", approval: "night-shift items need you", failed: "night-shift tasks failed" };

/** events rows from the focus window → counted lines, in a fixed order. */
export function workSummary(rows: { type: string; payload?: unknown }[]): WorkLine[] {
  const n = new Map<string, number>();
  for (const r of rows) {
    const status = r.type === "night.task" ? (r.payload as { status?: string } | null)?.status : undefined;
    const label = status ? NIGHT[status] : WORK[r.type];
    if (label) n.set(label, (n.get(label) ?? 0) + 1);
  }
  return [...Object.values(WORK), ...Object.values(NIGHT)].filter((l) => n.has(l)).map((label) => ({ label, n: n.get(label)! }));
}

export function summarize(f: Focus, held: HeldPush[], rows: { type: string; payload?: unknown }[], now: number): FocusSummary {
  return { id: f.id, goal: f.goal, minutes: f.minutes, actual: Math.max(0, Math.round((Math.min(now, f.endAt) - f.startAt) / 60_000)),
    held: held.map(({ tag, n }) => ({ tag, n })), work: workSummary(rows) };
}

/** focus.json → state; anything malformed is dropped. */
export function parseFocusState(raw: string): FocusState {
  let v: Record<string, unknown>;
  try { v = JSON.parse(raw); } catch { return FOCUS_START; }
  if (!v || typeof v !== "object") return FOCUS_START;
  const f = v.focus as Focus | null;
  const focus = f && typeof f.id === "string" && FOCUS_BLOCKS.includes(f.minutes) && typeof f.goal === "string"
    && Number.isFinite(f.startAt) && f.endAt === f.startAt + f.minutes * 60_000 ? { id: f.id, minutes: f.minutes, goal: f.goal.slice(0, GOAL_MAX), startAt: f.startAt, endAt: f.endAt } : null;
  const held = Array.isArray(v.held) ? (v.held as HeldPush[]).filter((h) => h && typeof h.tag === "string" && Number.isInteger(h.n) && h.n > 0 && h.msg?.tag === h.tag) : [];
  const last = v.last && typeof (v.last as FocusSummary).id === "string" ? (v.last as FocusSummary) : null;
  return { focus, userId: typeof v.userId === "string" ? v.userId : "", held, last };
}

// ---- Client: the galaxy's clock and the HUD ring ----

export const DILATED = 0.3; // the galaxy runs at 30% speed
const EASE_MS = 3000;
const smooth = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
/** Speed of the galaxy's clock: eases from 1 to DILATED over 3 s after the start and back over the last 3 s. */
export function dilationScale(f: Pick<Focus, "startAt" | "endAt"> | null | undefined, now: number): number {
  if (!isFocusActive(f, now)) return 1;
  const k = Math.min(smooth((now - f!.startAt) / EASE_MS), smooth((f!.endAt - now) / EASE_MS));
  return DILATED * k + (1 - k);
}

/** The ring: fraction of the block still left (1 → 0) and "mm:ss". */
export function ringLeft(f: Pick<Focus, "startAt" | "endAt">, now: number): { frac: number; label: string } {
  const left = Math.max(0, f.endAt - now), s = Math.ceil(left / 1000);
  return { frac: f.endAt > f.startAt ? left / (f.endAt - f.startAt) : 0, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
}
