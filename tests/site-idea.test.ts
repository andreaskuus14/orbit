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

test("assumptions: strings only, trimmed, at most 6; the brief validator still accepts a brief that carries them", async () => {
  const { assumptions } = await import("../src/lib/site-idea-pure.ts");
  assert.deepEqual(assumptions({ assumptions: [" Per evening ", 3, "", "x".repeat(200), "a", "b", "c", "d", "e"] }).length, 6);
  assert.equal(assumptions({ assumptions: [" Per evening "] })[0], "Per evening");
  assert.deepEqual(assumptions(null), []);
  const { parseBrief } = await import("../src/lib/site-brief-pure.ts");
  const fx = JSON.parse((await import("node:fs")).readFileSync(new URL("./fixtures/site-w02/brief-house.json", import.meta.url), "utf8"));
  assert.ok(!("errors" in parseBrief({ ...fx, assumptions: ["Assumed couples book one evening"] })));
});
