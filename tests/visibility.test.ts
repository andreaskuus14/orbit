import { test } from "node:test";
import assert from "node:assert/strict";
import { latest, parseCheck, validateName, withChecks, type Target } from "../src/lib/visibility-pure.ts";

test("visibility: names, parsing, changes", () => {
  assert.equal(validateName("  Fam_ClipsWW \n"), "Fam_ClipsWW");
  assert.ok(typeof validateName("x") === "object");
  assert.deepEqual(parseCheck('Sure: {"mentioned": true, "description": "A Shorts\\nclip channel."}', "web", "t"), { at: "t", source: "web", mentioned: true, description: "A Shorts clip channel." });
  assert.deepEqual(parseCheck('{"mentioned": false, "description": "made up"}', "claude", "t")?.description, "", "nothing described when not mentioned");
  assert.equal(parseCheck("no json", "web", "t"), null);
  assert.equal(parseCheck('{"mentioned": "yes"}', "web", "t"), null);
  let t: Target = { name: "Shop", checks: [] };
  t = withChecks(t, [{ at: "1", source: "web", mentioned: false, description: "" }]);
  assert.equal(latest(t, "web").changed, false);
  t = withChecks(t, [{ at: "2", source: "web", mentioned: true, description: "A bakery." }]);
  assert.equal(latest(t, "web").now?.at, "2");
  assert.equal(latest(t, "web").changed, true);
  assert.equal(latest(t, "claude").now, undefined);
});
