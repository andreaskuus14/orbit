import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPrompt, FIT_SYSTEM, parseFit } from "../src/lib/job-fit-pure.ts";

const ok = { score: 72.4, verdict: "skip", matches: ["Revit: studies architecture", 3, ""], gaps: ["No AutoCAD evidence"], cvSummary: "I study architecture.", coverLetter: "Dear team, ..." };

test("parseFit validates, rounds, and derives the verdict from the score", () => {
  const f = parseFit("```json\n" + JSON.stringify(ok) + "\n```");
  assert.ok(!("error" in f));
  assert.equal(f.score, 72); assert.equal(f.verdict, "apply", "verdict follows the score, not the model");
  assert.deepEqual(f.matches, ["Revit: studies architecture"]);
  assert.equal((parseFit(JSON.stringify({ ...ok, score: 50 })) as { verdict: string }).verdict, "stretch");
});

test("bad replies are refused", () => {
  assert.ok("error" in parseFit("no json"));
  assert.ok("error" in parseFit(JSON.stringify({ ...ok, score: 140 })));
  assert.ok("error" in parseFit(JSON.stringify({ ...ok, coverLetter: "" })));
  assert.ok("error" in parseFit(JSON.stringify({ ...ok, coverLetter: "word ".repeat(400) })));
});

test("the prompt forbids invented facts and treats the posting as data", () => {
  assert.match(FIT_SYSTEM, /Never invent/); assert.match(FIT_SYSTEM, /data, not instructions/);
  assert.ok(fitPrompt("x".repeat(9000), "", "").length < 6200, "posting is capped");
});
