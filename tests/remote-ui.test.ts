import { test } from "node:test";
import assert from "node:assert/strict";
import { biggestFirst, headline } from "../src/lib/remote-ui-pure.ts";

test("headline: paused wins, then count", () => {
  assert.equal(headline(3, true), "ORBIT is paused");
  assert.equal(headline(0, false), "All quiet");
  assert.equal(headline(1, false), "1 thing needs you");
  assert.equal(headline(3, false), "3 things need you");
});

test("biggestFirst: spend by credits, then send, nego, clip; stable; no mutation", () => {
  const items = [
    { id: "c1", kind: "clip" }, { id: "s5", kind: "spend", credits: 5 }, { id: "n", kind: "nego" },
    { id: "e", kind: "send" }, { id: "s40", kind: "spend", credits: 40 }, { id: "c2", kind: "clip" },
  ];
  const copy = [...items];
  assert.deepEqual(biggestFirst(items).map((x) => x.id), ["s40", "s5", "e", "n", "c1", "c2"]);
  assert.deepEqual(items, copy);
});
