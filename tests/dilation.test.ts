import { test } from "node:test";
import assert from "node:assert/strict";
import { DILATED, FOCUS_START, dilationScale, holdPush, isFocusActive, newFocus, parseFocusState, passesFocus, ringLeft, summarize, workSummary, type Focus } from "../src/lib/dilation-pure.ts";
import { pushLabel } from "../src/lib/remote-push-pure.ts";

const t0 = Date.parse("2026-10-26T10:00:00Z");
const f = newFocus(50, "  Finish   the pet sim shop ", t0, "f1") as Focus;

test("a block needs 25/50/90 minutes and one goal", () => {
  assert.deepEqual(f, { id: "f1", minutes: 50, goal: "Finish the pet sim shop", startAt: t0, endAt: t0 + 50 * 60_000 });
  assert.equal(typeof newFocus(30, "x", t0, "f"), "string");
  assert.equal(typeof newFocus(25, "   ", t0, "f"), "string");
  assert.equal((newFocus(90, "y".repeat(500), t0, "f") as Focus).goal.length, 140);
});

test("active from start up to (not including) the end", () => {
  assert.equal(isFocusActive(f, t0), true);
  assert.equal(isFocusActive(f, f.endAt - 1), true);
  assert.equal(isFocusActive(f, f.endAt), false);
  assert.equal(isFocusActive(null, t0), false);
});

test("urgent pushes pass; the rest coalesce per kind, latest label kept", () => {
  assert.ok(passesFocus("failed") && passesFocus("stop") && passesFocus("call"));
  assert.ok(!passesFocus("clip") && !passesFocus("night") && !passesFocus("deal"));
  let h = holdPush([], pushLabel("clip"));
  h = holdPush(h, pushLabel("deal"));
  h = holdPush(h, pushLabel("clip", 2));
  assert.deepEqual(h.map((x) => [x.tag, x.n, x.msg.title]), [["clip", 2, "2 new clips to review"], ["deal", 1, "Deal found"]]);
});

test("summary counts agent work by label only, ignores everything else", () => {
  const rows = [{ type: "task.delivered" }, { type: "task.delivered" }, { type: "night.task", payload: { status: "done" } }, { type: "night.task", payload: { status: "skipped" } },
    { type: "core.turn" }, { type: "autonomy.act" }];
  assert.deepEqual(workSummary(rows), [{ label: "agent tasks delivered", n: 2 }, { label: "auto actions taken", n: 1 }, { label: "night-shift tasks done", n: 1 }]);
  const s = summarize(f, holdPush([], pushLabel("clip")), rows, t0 + 20 * 60_000 + 20_000);
  assert.equal(s.actual, 20); // ended early
  assert.deepEqual(s.held, [{ tag: "clip", n: 1 }]);
  assert.equal(summarize(f, [], [], f.endAt + 3_600_000).actual, 50); // ended late: capped at the block
});

test("state file round-trips; corrupt or tampered data is dropped", () => {
  const st = { focus: f, userId: "u1", held: holdPush([], pushLabel("night")), last: null };
  assert.deepEqual(parseFocusState(JSON.stringify(st)), st);
  assert.deepEqual(parseFocusState("{oops"), FOCUS_START);
  assert.equal(parseFocusState(JSON.stringify({ ...st, focus: { ...f, endAt: f.endAt + 1 } })).focus, null);
  assert.equal(parseFocusState(JSON.stringify({ ...st, focus: { ...f, minutes: 45 } })).focus, null);
});

test("the galaxy eases into dilation and back out; the ring counts down", () => {
  assert.equal(dilationScale(f, t0), 1);
  assert.ok(Math.abs(dilationScale(f, t0 + 1500) - (1 + DILATED) / 2) < 1e-9);
  assert.equal(dilationScale(f, t0 + 60_000), DILATED);
  assert.equal(dilationScale(f, f.endAt), 1);
  assert.equal(dilationScale(null, t0), 1);
  assert.deepEqual(ringLeft(f, t0 + 25 * 60_000 - 500), { frac: (25 * 60_000 + 500) / (50 * 60_000), label: "25:01" });
  assert.deepEqual(ringLeft(f, f.endAt + 5), { frac: 0, label: "0:00" });
});
