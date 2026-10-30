import { test } from "node:test";
import assert from "node:assert/strict";
import { isTurn, newSince, parseKnown, showSetup } from "../src/lib/startup-pure.ts";
import { STEPS } from "../src/lib/tour-pure.ts";

test("startup: urgent alert > morning card > What's new, one at a time", () => {
  assert.equal(isTurn("tour", ["morning", "tour"]), false);
  assert.equal(isTurn("morning", ["alert", "morning"]), false);
  assert.equal(isTurn("alert", ["alert", "morning", "tour"]), true);
  assert.equal(isTurn("tour", ["tour"]), true); // morning dismissed: the tour's turn
  assert.equal(isTurn("morning", ["tour"]), true);
});

test("what's new: only steps newer than last seen; first run gets the top 5 and see-all", () => {
  const ids = STEPS.map((s) => s.id);
  assert.deepEqual(newSince(ids, null), { ids: ids.slice(0, 5), more: true });
  assert.deepEqual(newSince(ids, ids), { ids: [], more: false });
  assert.deepEqual(newSince([...ids, "new-a"], ids), { ids: ["new-a"], more: false });
  assert.equal(parseKnown("garbage"), null); assert.deepEqual(parseKnown('["a",1]'), ["a"]);
});

test("setup hint: migrations step only when the guard confirms them missing", () => {
  assert.equal(showSetup("migrations", null), false);
  assert.equal(showSetup("migrations", []), false);
  assert.equal(showSetup("migrations", ["0020"]), true);
  assert.equal(showSetup("migrations", ["0021"]), false);
  assert.equal(showSetup("vapid", null), true);
});

test("agent notices name the task, never its raw id, and open it", async () => {
  const { taskNotice } = await import("../src/lib/interruption-pure.ts");
  const id = "87751a9b-0000-4000-8000-000000000000";
  const n = taskNotice(id, "agent.completed", "done", "Draft the weekly client update for Acme and send for review");
  assert.ok(!`${n.title} ${n.reason} ${n.body}`.includes("87751a9b"));
  assert.match(n.reason!, /^“Draft the weekly client update for Acme and send for review”|^“.{60}”/);
  assert.deepEqual(n.nav, { panel: "operations", open: { kind: "task", id } });
  assert.equal(taskNotice(id, "agent.failed", undefined).reason, "Your task failed and needs review.");
});
