import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContains, checkFile, checkResearch, checkTests, expected, inferAcceptance, overlap, plan, reviewStep } from "../src/lib/mission-checks-pure.ts";

test("inferAcceptance: clear objectives inferred, vague ones need a question", () => {
  assert.match(inferAcceptance("Research the best budget laptops")!, /cite sources/);
  assert.match(inferAcceptance('Draft a pitch deck mentioning "Q3 revenue"')!, /must contain "Q3 revenue"/);
  assert.match(inferAcceptance("Fix the login bug")!, /tests pass/);
  assert.equal(inferAcceptance("Ship it"), null);
  assert.deepEqual(expected(`report; must contain "a1", "bb"`), ["a1", "bb"]);
});

test("checkFile: deliberately broken files fail", () => {
  assert.ok(checkFile("d.json", '{"a":1}').ok);
  assert.ok(!checkFile("d.json", '{"a":').ok);
  assert.ok(!checkFile("x.csv", "a,b\n1,2,3").ok);
  assert.ok(checkFile("x.csv", "a,b\n1,2").ok);
  assert.ok(!checkFile("p.pdf", "%PDF-1.4 truncated").ok);
  assert.ok(!checkFile("i.html", "   ").ok);
  assert.ok(!checkFile("i.html", "just text").ok);
});

test("checkContains / checkTests", () => {
  assert.ok(checkContains("x", "Q3 Revenue up", ["q3 revenue"]).ok);
  assert.match(checkContains("x", "nothing", ["Q3"]).what, /missing "Q3"/);
  assert.ok(checkTests(0, "# pass 4\n# fail 0").ok);
  assert.ok(!checkTests(0, "# pass 3\n# fail 1").ok);
  assert.ok(!checkTests(1, "").ok);
});

test("checkResearch: uncited or unfetched sources fail", () => {
  const fetched = [{ url: "https://example.com/a", at: "t", evidence: "Fact one about apples" }];
  assert.ok(checkResearch("Fact one about apples [A](https://example.com/a)", fetched).every((c) => c.ok));
  assert.ok(!checkResearch("Fact with no source.", fetched)[0].ok);
  assert.match(checkResearch("Fact [F](https://fake.org/made-up)", fetched)[0].what, /never fetched/);
});

test("reviewStep: disproved assumption and loops stop, failed check revises", () => {
  const long = "A detailed result about laptops, prices and models in 2026.";
  assert.equal(reviewStep(0, `${long}\nDISPROVED: prices fell — they rose 8%`, null, []).do, "stop");
  assert.equal(reviewStep(1, "ok", long, []).do, "stop");
  assert.equal(reviewStep(1, long, long, []).do, "stop");
  assert.ok(overlap(long, long) > 0.9);
  const r = reviewStep(0, long, null, [{ step: 0, ok: false, what: "d.json: JSON does not parse" }]);
  assert.ok(r.do === "revise" && /JSON does not parse/.test(r.note));
  assert.equal(reviewStep(0, long, null, [{ step: 0, ok: true, what: "fine" }]).do, "continue");
});

test("plan: effort and stop conditions", () => {
  const p = plan([{ agent: "atlas" }, { agent: "forge" }], 2);
  assert.equal(p.minutes, 7);
  assert.ok(p.stops.some((s) => /2×/.test(s)));
});
