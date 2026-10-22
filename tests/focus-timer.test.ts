import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceFocusTimer, focusPhaseSeconds, freshFocusTimer, restoreFocusTimer, type FocusTimer } from "../src/lib/focus-timer-pure.ts";

const now = Date.parse("2026-10-22T12:00:00Z");
const restore = (timer: FocusTimer, at = now) => restoreFocusTimer(JSON.stringify(timer), at);

test("running focus and break preserve their deadline and selected plan", () => {
  for (const plan of [25, 50] as const) for (const phase of ["focus", "break"] as const) {
    const timer = { plan, phase, endAt: now + 42_000, left: focusPhaseSeconds(plan, phase) };
    assert.deepEqual(restore(timer), { timer, expired: false, completedMinutes: 0 });
  }
});

test("paused focus and break keep their remaining seconds without completing", () => {
  for (const phase of ["focus", "break"] as const) {
    const timer: FocusTimer = { plan: 50, phase, endAt: 0, left: 123 };
    assert.deepEqual(restore(timer), { timer, expired: false, completedMinutes: 0 });
    assert.equal(restore(timer, now + 86_400_000).completedMinutes, 0);
  }
});

test("expired focus logs once then starts a full break at restore time, even after a long absence", () => {
  for (const plan of [25, 50] as const) {
    const expired: FocusTimer = { plan, phase: "focus", endAt: now - 86_400_000, left: plan * 60 };
    const result = restore(expired);
    assert.equal(result.expired, true);
    assert.equal(result.completedMinutes, plan);
    assert.deepEqual(result.timer, { plan, phase: "break", left: plan / 5 * 60, endAt: now + plan / 5 * 60_000 });
    // Saving the transition before the POST makes a second reload and the next tick non-logging.
    assert.equal(restore(result.timer).completedMinutes, 0);
    assert.equal(advanceFocusTimer(result.timer, now + 500).completedMinutes, 0);
    const breakEnd = restore(result.timer, result.timer.endAt);
    assert.deepEqual(breakEnd, { timer: { plan, phase: "focus", endAt: 0, left: plan * 60 }, expired: true, completedMinutes: 0 });
    assert.equal(restore(breakEnd.timer, now + 172_800_000).completedMinutes, 0);
  }
});

test("a deadline equal to now completes, while one millisecond left is still running", () => {
  const timer: FocusTimer = { plan: 25, phase: "focus", endAt: now, left: 1 };
  assert.equal(restore(timer).completedMinutes, 25);
  assert.equal(restore(timer, now - 1).expired, false);
});

test("missing, malformed and out-of-range stored fields reset safely without logging", () => {
  const base = freshFocusTimer();
  const bad = [null, "", "{", "null", "[]", "true", "42", "{}",
    ...[
      { plan: 30 }, { phase: "work" }, { endAt: -1 }, { endAt: "123" }, { endAt: 1.5 }, { endAt: 9e15 },
      { left: -1 }, { left: 1501 }, { left: "25" }, { left: 1.5 }, { phase: "break", left: 301 },
    ].map(patch => JSON.stringify({ ...base, ...patch })),
  ];
  for (const raw of bad) assert.deepEqual(restoreFocusTimer(raw, now), { timer: base, expired: false, completedMinutes: 0 });
});
