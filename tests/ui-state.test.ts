import { test } from "node:test";
import assert from "node:assert/strict";
import { settle, shown, nextTab, SPIN_LIMIT_MS } from "../src/lib/ui-state-pure.ts";

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
