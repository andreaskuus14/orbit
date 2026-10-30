import { test } from "node:test";
import assert from "node:assert/strict";
import { linkToHash, linkFromHash, withView, shouldPush } from "../src/lib/deeplink-pure.ts";

test("round-trips planet, view and record by internal id", () => {
  for (const l of [{ planet: "creation" as const }, { planet: "business" as const, view: "client", kind: "client" as const, id: "a1-b2" }, { planet: "operations" as const, kind: "task" as const, id: "t9" }])
    assert.deepEqual(linkFromHash(linkToHash(l)), l);
  assert.equal(linkToHash(null), "");
});

test("rejects foreign or unsafe hashes", () => {
  assert.equal(linkFromHash("#r-call"), null);
  assert.equal(linkFromHash("#o=gamedev"), null); // display names are not targets
  assert.deepEqual(linkFromHash("#o=business&k=client&id=<x>"), { planet: "business" });
  assert.deepEqual(linkFromHash("#o=business&k=evil&id=x"), { planet: "business" });
});

test("withView only rewrites the same planet", () => {
  assert.equal(linkFromHash(withView("#o=business&k=client&id=x", "business", "money"))?.view, "money");
  assert.equal(withView("#o=life", "business", "money"), "#o=life");
  assert.equal(withView("", "business", "money"), "");
});

test("push for a new planet or record, replace for closing a record or a tab", () => {
  assert.equal(shouldPush(null, { planet: "business" }), true);
  assert.equal(shouldPush({ planet: "business" }, { planet: "business", kind: "client", id: "x" }), true);
  assert.equal(shouldPush({ planet: "business", kind: "client", id: "x" }, { planet: "business" }), false);
  assert.equal(shouldPush({ planet: "business" }, { planet: "business", view: "money" }), false);
  assert.equal(shouldPush({ planet: "business" }, null), false);
});
