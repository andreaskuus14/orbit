import { test } from "node:test";
import assert from "node:assert/strict";
import { deptOf, pickFair } from "../src/lib/agent-queue-pure.ts";

test("a busy department doesn't block the others; oldest wins inside a department and on ties", () => {
  const q = [{ id: "b1", agent: "prospector" }, { id: "b2", agent: "outreach" }, { id: "n1", agent: "pulse" }];
  assert.equal(pickFair(q, []), "b1", "nothing running: plain oldest first");
  assert.equal(pickFair(q, ["closer"]), "n1", "business already has one running: news goes next");
  assert.equal(pickFair(q, ["closer", "pulse"]), "b1", "equal load: oldest");
  assert.equal(pickFair([], ["nova"]), null);
  assert.equal(deptOf("my-custom-agent"), "custom");
  assert.equal(pickFair([{ id: "c", agent: "my-custom-agent" }, { id: "s", agent: "scout" }], ["atlas"]), "c");
});
