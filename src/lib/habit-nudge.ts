// Habit engine glue (roadmap 3): every scheduler tick (which already stops under Stop-all) nudge the habits whose moment has come.
// Push: a fixed label plus the habit id for the one-tap Done (never the name). Toast: queued here, drained by the PC's LifeReminders poll.
// Focus blocks: focus.ts focusActive. No model calls; LIFE data stays on the PC.
import { claimNudges } from "./life";
import { pushLabel, quietAt } from "./remote-push-pure";
import { stopAllOn } from "./stop-all";
import { focusActive } from "./focus";

export type HabitToast = { id: string; name: string; emoji: string; at: number };
const g = globalThis as unknown as { __orbitHabits?: { toasts: HabitToast[] } };
const S = (g.__orbitHabits ??= { toasts: [] });
const TOAST_FRESH_MS = 30 * 60_000; // an in-app nudge nobody saw for 30 min is past its moment

export const takeHabitToasts = (now = Date.now()) => S.toasts.splice(0).filter((t) => now - t.at < TOAST_FRESH_MS);

export async function tickHabits(now = Date.now()): Promise<void> {
  const due = await claimNudges(now, { quiet: quietAt(now), focus: focusActive(now), stop: stopAllOn() });
  for (const h of due) {
    const push = h.nudge === "push" ? await import("./remote-push") : null;
    const sent = push && !push.pushProblem() ? await push.deliver({ ...pushLabel("habit"), url: `/remote?habit=${h.id}#r-habit`, habit: h.id }) : 0;
    if (!sent) S.toasts = [...S.toasts, { id: h.id, name: h.name, emoji: h.emoji, at: now }].slice(-10); // toast, or push not set up / phone unreachable
  }
}
