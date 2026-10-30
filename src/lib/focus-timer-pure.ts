export const FOCUS_TIMER_KEY = "orbit.focus-timer.v1";
export type FocusPhase = "focus" | "break";
/** task: what the session is for (LIF05; its minutes are logged against it); at: last change, so the newest copy wins across devices. */
export type FocusTimer = { plan: 25 | 50; phase: FocusPhase; endAt: number; left: number; task?: string; at?: number };
export type RestoredFocusTimer = { timer: FocusTimer; expired: boolean; completedMinutes: number };

export const focusPhaseSeconds = (plan: FocusTimer["plan"], phase: FocusPhase) => (phase === "focus" ? plan : plan / 5) * 60;
export const freshFocusTimer = (): FocusTimer => ({ plan: 25, phase: "focus", endAt: 0, left: 25 * 60 });

/** Same transition for a live tick and a reload: start the break now; next focus waits for Start. */
export function advanceFocusTimer(timer: FocusTimer, now: number): RestoredFocusTimer {
  if (!timer.endAt || timer.endAt > now) return { timer, expired: false, completedMinutes: 0 };
  const phase = timer.phase === "focus" ? "break" : "focus";
  const left = focusPhaseSeconds(timer.plan, phase);
  return {
    timer: { plan: timer.plan, phase, left, endAt: phase === "break" ? now + left * 1000 : 0, ...(timer.task && { task: timer.task }), at: now },
    expired: true,
    completedMinutes: timer.phase === "focus" ? timer.plan : 0,
  };
}

/** Validate localStorage without browser dependencies. Persist the returned state BEFORE logging completedMinutes. */
export function restoreFocusTimer(raw: string | null, now: number): RestoredFocusTimer {
  let timer: FocusTimer = freshFocusTimer();
  try {
    const value = JSON.parse(raw ?? "null");
    if (value && (value.plan === 25 || value.plan === 50) && (value.phase === "focus" || value.phase === "break")
      && Number.isSafeInteger(value.endAt) && value.endAt >= 0 && value.endAt <= 8.64e15
      && Number.isInteger(value.left) && value.left >= 0 && value.left <= focusPhaseSeconds(value.plan, value.phase)) {
      timer = { plan: value.plan, phase: value.phase, endAt: value.endAt, left: value.left,
        ...(typeof value.task === "string" && value.task.trim() && { task: value.task.trim().slice(0, 120) }), ...(Number.isSafeInteger(value.at) && value.at > 0 && { at: value.at }) };
    }
  } catch { /* missing or corrupt data starts a fresh paused timer */ }
  return advanceFocusTimer(timer, now);
}

/** Device switch: this device's copy vs the server's; the most recently changed one wins (missing at = oldest). */
export const pickTimer = (local: FocusTimer, remote: FocusTimer | null | undefined): FocusTimer => (remote && (remote.at ?? 0) > (local.at ?? 0) ? remote : local);

/** Whole minutes of focus actually worked in the current focus phase (for Stop: logs real work, not the plan). */
export function workedMinutes(t: FocusTimer, now: number): number {
  if (t.phase !== "focus") return 0;
  const left = t.endAt ? Math.max(0, Math.ceil((t.endAt - now) / 1000)) : t.left;
  return Math.floor((focusPhaseSeconds(t.plan, "focus") - left) / 60);
}
