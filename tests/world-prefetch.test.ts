import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisits, prefetchOrder } from "../src/lib/world-prefetch-pure.ts";

const ALL = ["studio", "intelligence", "creation", "agents"];

test("prefetchOrder: most visited first, default order breaks ties, capped at n", () => {
  assert.deepEqual(prefetchOrder({}, ALL, 2), ["studio", "intelligence"]);
  assert.deepEqual(prefetchOrder({ agents: 5, creation: 2 }, ALL, 3), ["agents", "creation", "studio"]);
  assert.deepEqual(prefetchOrder({ agents: 1, studio: 1 }, ALL, 4), ["studio", "agents", "intelligence", "creation"]);
  assert.deepEqual(prefetchOrder({ x: 9 }, ALL, 0), []);
});

test("parseVisits: only positive finite counts survive", () => {
  assert.deepEqual(parseVisits(null), {});
  assert.deepEqual(parseVisits("not json"), {});
  assert.deepEqual(parseVisits("[1,2]"), {});
  assert.deepEqual(parseVisits('{"studio":3,"agents":"x","arch":-1,"memory":0}'), { studio: 3 });
});
