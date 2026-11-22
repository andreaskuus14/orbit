// CORE's presence (feat/ui-motion): which pose the orb is in. listening · thinking · tool (which one) · writing · done · error.
// Each pose is held long enough to read (no flicker when a tool takes 40 ms), then the next one plays; done settles back to idle.
// Fed by CoreChat's stream (CORE_PHASE_EVENT) and the voice input. Pure; tests in tests/ui-motion.test.ts.
import { plainStep } from "./progress-pure.ts";
import type { Lang } from "./i18n-pure.ts";

export const CORE_PHASE_EVENT = "orbit:core-phase";
export type CorePhase = "idle" | "listening" | "thinking" | "tool" | "writing" | "done" | "error";
export type PhaseEvent = { type: "listen" } | { type: "listen_end" } | { type: "submit" } | { type: "tool"; tool: string } | { type: "tool_end" }
  | { type: "delta" } | { type: "done" } | { type: "error" } | { type: "reset" };
export type PhaseState = { phase: CorePhase; tool: string | null; since: number; next: { phase: CorePhase; tool: string | null } | null };

/** Least time a pose stays on screen (ms) before the next one may replace it: a clear pose, then the change. */
export const HOLD: Record<CorePhase, number> = { idle: 0, listening: 0, thinking: 420, tool: 520, writing: 0, done: 0, error: 0 };
/** How long done / error stay before the orb settles back to idle. */
export const SETTLE: Partial<Record<CorePhase, number>> = { done: 1100, error: 2600 };

export const idlePhase = (now = 0): PhaseState => ({ phase: "idle", tool: null, since: now, next: null });

function target(s: PhaseState, ev: PhaseEvent): { phase: CorePhase; tool: string | null } | null {
  const cur = s.next ?? s;
  switch (ev.type) {
    case "reset": return { phase: "idle", tool: null };
    case "listen": return cur.phase === "idle" || cur.phase === "done" || cur.phase === "error" ? { phase: "listening", tool: null } : null;
    case "listen_end": return cur.phase === "listening" ? { phase: "idle", tool: null } : null;
    case "submit": return { phase: "thinking", tool: null };
    case "tool": return cur.phase === "idle" || cur.phase === "done" ? null : { phase: "tool", tool: ev.tool };
    case "tool_end": return cur.phase === "tool" ? { phase: "thinking", tool: null } : null;
    case "delta": return cur.phase === "thinking" || cur.phase === "tool" || cur.phase === "listening" ? { phase: "writing", tool: null } : null;
    case "done": return cur.phase === "idle" ? null : { phase: "done", tool: null };
    case "error": return { phase: "error", tool: null };
  }
}

/** Apply an event at time `now`. If the current pose hasn't been held long enough, the change waits in `next` (later events
 *  replace it), and `tick` plays it once the hold is over. Errors and resets never wait. */
export function phaseReduce(s: PhaseState, ev: PhaseEvent, now: number): PhaseState {
  const t = target(s, ev);
  if (!t) return s;
  if (t.phase === s.phase && t.tool === s.tool) return s.next ? { ...s, next: null } : s;
  const urgent = ev.type === "error" || ev.type === "reset";
  if (!urgent && now - s.since < HOLD[s.phase]) return { ...s, next: t };
  return { phase: t.phase, tool: t.tool, since: now, next: null };
}

/** Time passing: play a waiting change once the hold is over, and settle done/error back to idle. */
export function phaseTick(s: PhaseState, now: number): PhaseState {
  if (s.next && now - s.since >= HOLD[s.phase]) return { phase: s.next.phase, tool: s.next.tool, since: now, next: null };
  const settle = SETTLE[s.phase];
  if (!s.next && settle !== undefined && now - s.since >= settle) return idlePhase(now);
  return s;
}

/** Next moment `phaseTick` would change something (ms from now), or null: lets the component sleep instead of polling. */
export function nextTickIn(s: PhaseState, now: number): number | null {
  if (s.next) return Math.max(0, HOLD[s.phase] - (now - s.since));
  const settle = SETTLE[s.phase];
  return settle === undefined ? null : Math.max(0, settle - (now - s.since));
}

/** The plain label under the orb. Tools use the same plain words as the progress card ("Searching the web"). */
export function phaseLabel(s: Pick<PhaseState, "phase" | "tool">, lang: Lang): string {
  const et = lang === "et";
  switch (s.phase) {
    case "idle": return "";
    case "listening": return et ? "Kuulan" : "Listening";
    case "thinking": return et ? "Mõtlen" : "Thinking";
    case "tool": { const w = s.tool ? plainStep(s.tool, lang) : ""; return w && w !== (et ? "Töötan" : "Working") ? w : et ? "Kasutan tööriista" : "Using a tool"; }
    case "writing": return et ? "Kirjutan" : "Writing";
    case "done": return et ? "Valmis" : "Done";
    case "error": return et ? "Ei õnnestunud" : "Didn't work";
  }
}
