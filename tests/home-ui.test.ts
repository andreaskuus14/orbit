import { test } from "node:test";
import assert from "node:assert/strict";
import { badge, displayName, joinDetail, meterBars, planetReadout } from "../src/lib/home-ui-pure.ts";
import { fromNeed } from "../src/lib/progress-pure.ts";
import type { WorldStatus } from "../src/lib/galaxy-status-pure.ts";

const st = (o: Partial<WorldStatus>): WorldStatus => ({ state: "working", working: 0, needs: 0, broke: 0, leftMin: null, line: "", ...o });

test("displayName: sentence case for shouted names, names and mixed case kept", () => {
  assert.equal(displayName("GAME DEV"), "Game dev");
  assert.equal(displayName("MÄLU"), "Mälu");
  assert.equal(displayName("ARCH"), "Arch");
  assert.equal(displayName("CORE"), "CORE");
  assert.equal(displayName("Studio"), "Studio");
  assert.equal(displayName(""), "");
});

test("planetReadout: problems, then needs, then jobs and time; idle is empty; at most three parts", () => {
  assert.equal(planetReadout(undefined, "en"), "");
  assert.equal(planetReadout(st({ state: "idle" }), "en"), "");
  assert.equal(planetReadout(st({ working: 2, leftMin: 4 }), "en"), "2 jobs · 4 min left");
  assert.equal(planetReadout(st({ working: 1, leftMin: 1 }), "en"), "1 job · almost done");
  assert.equal(planetReadout(st({ state: "needs", needs: 1, working: 1, leftMin: 3 }), "en"), "1 needs you · 1 job · 3 min left");
  assert.equal(planetReadout(st({ state: "broke", broke: 2, needs: 1, working: 3, leftMin: 9 }), "en"), "2 problems · 1 needs you · 3 jobs");
  assert.equal(planetReadout(st({ working: 14 }), "en"), "9+ jobs");
  assert.equal(planetReadout(st({ working: 2, leftMin: 130 }), "en"), "2 jobs · 2 h left");
  assert.equal(planetReadout(st({ working: 2, leftMin: 4 }), "et"), "2 töös · 4 min veel");
  assert.equal(planetReadout(st({ working: 1, leftMin: Number.NaN }), "en"), "1 job");
});

test("badge: empty for nothing, 9+ past nine", () => {
  assert.equal(badge(0), ""); assert.equal(badge(null), ""); assert.equal(badge(-1), ""); assert.equal(badge(Number.NaN), "");
  assert.equal(badge(3), "3"); assert.equal(badge(9), "9"); assert.equal(badge(10), "9+");
});

test("meterBars: flat when quiet, taller when loud, always 0.15..1, safe with bad input", () => {
  const q = meterBars(0, 1), l = meterBars(1, 1);
  assert.equal(q.length, 9);
  assert.ok(q.every((h) => h === 0.15));
  assert.ok(l.every((h) => h >= 0.15 && h <= 1));
  assert.ok(Math.max(...l) > 0.6);
  assert.ok(l[4] >= l[0]); // the middle is the tallest part
  assert.deepEqual(meterBars(Number.NaN, Number.NaN, 5), [0.15, 0.15, 0.15, 0.15, 0.15]);
});

test("joinDetail / fromNeed: one sentence end between detail and question (no '..')", () => {
  assert.equal(joinDetail("Draft is ready.", "Approve?"), "Draft is ready. Approve?");
  assert.equal(joinDetail("Draft is ready", "Approve?"), "Draft is ready. Approve?");
  assert.equal(joinDetail("", "Approve?"), "Approve?");
  assert.equal(joinDetail("Done!", ""), "Done!");
  const p = fromNeed({ ref: "a", kind: "decide", cause: "approval", title: "Send?", detail: "Nothing is sent until you approve." }, "Approve or reject this exact version?", "Review");
  assert.equal(p.result?.text, "Nothing is sent until you approve. Approve or reject this exact version?");
});
