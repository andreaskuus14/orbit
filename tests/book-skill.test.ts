import { test } from "node:test";
import assert from "node:assert/strict";
import { chapters, parseChapter, parseSkill, pick, skillName, CHAPTER_CHARS } from "../src/lib/book-skill-pure.ts";

const para = (w: string) => `${w} `.repeat(80);
test("chapters: split on headings, long chapters chunked, tiny fragments dropped", () => {
  const book = `Chapter 1 Daylight\n${para("window light")}\nChapter 2 Stairs\n${para("riser tread")}\n# Short\nx`;
  const c = chapters(book);
  assert.deepEqual(c.map((x) => x.title), ["Chapter 1 Daylight", "Chapter 2 Stairs"]);
  assert.equal(chapters("a".repeat(CHAPTER_CHARS * 2 + 500)).length, 3, "no headings: fixed chunks");
});
test("parseChapter: rejects junk, clips lists, keeps glossary pairs", () => {
  assert.ok("error" in parseChapter(null));
  assert.ok("error" in parseChapter({ title: "x", summary: "y", concepts: [] }));
  const c = parseChapter({ title: "Stairs", summary: "How stairs work.", concepts: Array(12).fill("Rise and run"), glossary: [{ term: "riser", meaning: "vertical part" }, { bad: 1 }] });
  assert.ok(!("error" in c) && c.concepts.length === 8 && c.glossary.length === 1 && c.frameworks.length === 0);
});
test("pick: only the relevant chapters, within budget; skill files round-trip", () => {
  const ch = (title: string, concept: string) => ({ title, section: "", summary: `${title}.`, concepts: [concept], frameworks: [], techniques: [], glossary: [] });
  const skill = parseSkill({ title: "Neufert", source: "neufert.pdf", chapters: [ch("Daylight", "Windows should be a fifth of floor area"), ch("Stairs", "Two risers plus one tread equals 630 mm")] })!;
  const p = pick(skill, "how big should stair treads and risers be?");
  assert.match(p, /Stairs/); assert.doesNotMatch(p, /Daylight/);
  assert.ok(pick(skill, "stairs", 120).length <= 200);
  assert.equal(skillName("Neufert 4th ed.pdf"), "Neufert 4th ed.skill.json");
  assert.equal(parseSkill({ title: "x", source: "y", chapters: [{}] }), null);
});
