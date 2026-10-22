export const FOCUS_TIMER_KEY = "orbit.focus-timer.v1";
export type FocusPhase = "focus" | "break";
export type FocusTimer = { plan: 25 | 50; phase: FocusPhase; endAt: number; left: number };
export type RestoredFocusTimer = { timer: FocusTimer; expired: boolean; completedMinutes: number };

export const focusPhaseSeconds = (plan: FocusTimer["plan"], phase: FocusPhase) => (phase === "focus" ? plan : plan / 5) * 60;
export const freshFocusTimer = (): FocusTimer => ({ plan: 25, phase: "focus", endAt: 0, left: 25 * 60 });

/** Same transition for a live tick and a reload: start the break now; next focus waits for Start. */
export function advanceFocusTimer(timer: FocusTimer, now: number): RestoredFocusTimer {
  if (!timer.endAt || timer.endAt > now) return { timer, expired: false, completedMinutes: 0 };
  const phase = timer.phase === "focus" ? "break" : "focus";
  const left = focusPhaseSeconds(timer.plan, phase);
  return {
    timer: { plan: timer.plan, phase, left, endAt: phase === "break" ? now + left * 1000 : 0 },
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
      timer = { plan: value.plan, phase: value.phase, endAt: value.endAt, left: value.left };
    }
  } catch { /* missing or corrupt data starts a fresh paused timer */ }
  return advanceFocusTimer(timer, now);
}
