import { test } from "node:test";
import assert from "node:assert/strict";
import { settle, shown, nextTab, splitTabs, SPIN_LIMIT_MS } from "../src/lib/ui-state-pure.ts";

test("spinners time out into failed", () => {
  assert.equal(settle("loading", 0, SPIN_LIMIT_MS - 1), "loading");
  assert.equal(settle("loading", 0, SPIN_LIMIT_MS), "failed");
  assert.equal(settle("saving", 0, 5, 5), "failed");
  assert.equal(settle("stale", 0, 1e9), "stale");
});

test("missing is not zero", () => {
  assert.equal(shown(0), "0");
  assert.equal(shown(null), "—");
  assert.equal(shown(undefined), "—");
  assert.equal(shown(NaN), "—");
  assert.equal(shown(3, (n) => `€${n}`), "€3");
});

test("tab keyboard path", () => {
  assert.equal(nextTab("ArrowRight", 2, 3), 0);
  assert.equal(nextTab("ArrowLeft", 0, 3), 2);
  assert.equal(nextTab("Home", 2, 3), 0);
  assert.equal(nextTab("End", 0, 3), 2);
  assert.equal(nextTab("Enter", 0, 3), null);
  assert.equal(nextTab("Home", 0, 0), null);
});

test("splitTabs: secondary views go behind More, the open one stays in the row", () => {
  const v = [{ id: "a" }, { id: "b" }, { id: "c", secondary: true }, { id: "d", secondary: true }];
  const ids = (x: { id: string }[]) => x.map((y) => y.id);
  assert.deepEqual(ids(splitTabs(v, "a").row), ["a", "b"]);
  assert.deepEqual(ids(splitTabs(v, "a").more), ["c", "d"]);
  assert.deepEqual(ids(splitTabs(v, "d").row), ["a", "b", "d"]);
  assert.deepEqual(ids(splitTabs(v, "d").more), ["c"]);
  assert.deepEqual(splitTabs([{ id: "a" }], "a").more, []); // nothing secondary: no More menu
});
