import { test } from "node:test";
import assert from "node:assert/strict";
import { tickAt } from "../src/lib/tick-pure.ts";

test("tickAt eases from start to end and lands exactly", () => {
  assert.equal(tickAt(0, 100, 0, 600), 0);
  assert.equal(tickAt(0, 100, 600, 600), 100);
  assert.equal(tickAt(0, 100, 9999, 600), 100);
  const mid = tickAt(0, 100, 300, 600);
  assert.ok(mid > 50 && mid < 100, `ease-out passes half early (${mid})`);
  assert.equal(tickAt(50, 10, 0, 600), 50); // counts down too
  assert.equal(tickAt(5, 9, 100, 0), 9); // no duration: jump
});
