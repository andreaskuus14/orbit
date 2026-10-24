import { test } from "node:test";
import assert from "node:assert/strict";
import { passesChanged, skipFrame } from "../src/lib/warm-pure.ts";

test("a composer warms on its first frame and again only when its passes change", () => {
  const a = {}, b = {}, c = {};
  assert.equal(passesChanged(undefined, [a, b]), true);
  const w = { passes: [a, b], ready: true, until: 0 };
  assert.equal(passesChanged(w, [a, b]), false);
  assert.equal(passesChanged(w, [a, c]), true); // a pass rebuilt (e.g. an effect toggled)
  assert.equal(passesChanged(w, [a]), true);
  assert.equal(passesChanged(w, [a, b, c]), true);
});

test("frames are skipped only while compiling and before the deadline", () => {
  assert.equal(skipFrame({ passes: [], ready: false, until: 2000 }, 1000), true);
  assert.equal(skipFrame({ passes: [], ready: false, until: 2000 }, 2000), false); // stuck: draw anyway
  assert.equal(skipFrame({ passes: [], ready: true, until: 2000 }, 1000), false);
});
