import { test } from "node:test";
import assert from "node:assert/strict";
import { firstJson, pickDirection, placeholders, siteSlugName, IDEA_SYSTEM } from "../src/lib/site-idea-pure.ts";

test("direction follows the subject", () => {
  assert.equal(pickDirection("A site for my lake sauna in Lahemaa"), "daylight");
  assert.equal(pickDirection("Landing page for our coffee shop"), "editorial");
  assert.equal(pickDirection("A trailer page for my indie game"), "cinematic");
});
test("firstJson tolerates fences and chatter; bad JSON is null", () => {
  assert.deepEqual(firstJson('Here:\n```json\n{"name":"Tuuli"}\n```'), { name: "Tuuli" });
  assert.equal(firstJson("no json"), null);
  assert.equal(firstJson("{broken"), null);
});
test("placeholders are listed once; slugs are clean", () => {
  assert.deepEqual(placeholders({ a: "[price] € per evening", b: "[price]", c: "[address]" }), ["[price]", "[address]"]);
  assert.equal(siteSlugName("Tuuli Sauna!"), "tuuli-sauna-site");
  assert.equal(siteSlugName("!!!"), "site-site");
});
test("the prompt forbids invented facts", () => assert.match(IDEA_SYSTEM, /square brackets/));
