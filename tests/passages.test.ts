import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPassages, selectPassages, scorePassages } from "../src/lib/passages.ts";

const filler = (n: number, word = "lorem") => Array.from({ length: n }, (_, i) => `Paragraph ${i} about ${word} ipsum dolor sit amet, general background text that says nothing specific at all. `.repeat(6)).join("\n\n");
const longDoc = `# Project notes\n\nIntro summary of the project.\n\n## History\n\n${filler(30)}\n\n## Deployment\n\nWe deploy ORBIT to Fly.io in region arn. The production database password rotation happens every 90 days.`;

test("answer at the end of a long doc is selected, with heading-path label", () => {
  const out = selectPassages(longDoc, "Where do we deploy ORBIT and in which region?", 6000, 3);
  assert.ok(out.includes("Fly.io in region arn"), out.slice(-500));
  assert.match(out, /\[M3 §\d+ "Project notes > Deployment"\]/);
  assert.ok(out.indexOf("Intro summary") < 80, "summary first");
  assert.ok(String(longDoc).slice(0, 6000).indexOf("Fly.io") < 0, "old first-N-chars would miss it");
});

test("budget respected, short content untouched", () => {
  for (const b of [1500, 3000, 6000]) assert.ok(selectPassages(longDoc, "deploy region", b, 1).length <= b, String(b));
  assert.equal(selectPassages("short note", "anything", 1500, 1), "short note");
});

test("headings kept as path; passages are ~800-1200 chars", () => {
  const ps = splitPassages(longDoc);
  assert.ok(ps.every((p) => p.text.length <= 1200), "max size");
  assert.ok(ps.filter((p) => p.path.join(">") === "Project notes>History").length > 3);
  assert.deepEqual(ps.at(-1)!.path, ["Project notes", "Deployment"]);
  const nested = splitPassages("# A\n\nx\n\n### C\n\ny\n\n## B\n\nz");
  assert.deepEqual(nested.map((p) => p.path), [["A"], ["A", "", "C"], ["A", "B"]]);
});

test("neighbours of the best passage are included", () => {
  const doc = Array.from({ length: 20 }, (_, i) => `## Part ${i}\n\n${i === 10 ? "The secret launch codename is Bluefin." : `Ordinary filler text number ${"x".repeat(10)} `.repeat(25)}`).join("\n\n");
  const out = selectPassages(doc, "what is the launch codename", 3200, 1);
  for (const n of ["Part 9", "Part 10", "Part 11"]) assert.ok(out.includes(`"${n}"`), n);
  assert.ok(out.includes("Bluefin"));
});

test("non-English text and numbers score", () => {
  const doc = `# Märkmed\n\n${filler(20, "üldine")}\n\n## Eelarve\n\nMängu eelarve on 4500 eurot ja tähtaeg on 2027.\n\n${filler(10, "muu")}`;
  const out = selectPassages(doc, "Kui suur on mängu eelarve?", 2500, 2);
  assert.ok(out.includes("4500 eurot"), out);
  const ps = splitPassages(doc);
  const s = scorePassages(ps, "tähtaeg 2027");
  assert.equal(ps[s.indexOf(Math.max(...s))].path.at(-1), "Eelarve");
});

test("no lexical match falls back to reading from the top", () => {
  const out = selectPassages(longDoc, "zzzz qqqq", 3000, 1);
  assert.ok(out.indexOf("Intro summary") < 80);
  assert.ok(!out.includes("Fly.io"));
});
