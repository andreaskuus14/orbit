import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterTimes, chaptersText, lengthProblem, scriptMd, shotCsv, shotList, speakSec, stamp, totalSec, validPlan, visualDraft, words, type LongPlan } from "../src/lib/clips/longform-pure.ts";
import { validDraft } from "../src/lib/higgsfield-pure.ts";

const say = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const raw = (perChapter = 300) => ({
  titles: ["One", "Two", "Three", "Two"],
  hook: say(50),
  chapters: [0, 1, 2, 3].map((i) => ({ title: `Ch ${i}`, script: say(perChapter), shots: [{ type: "a-roll", desc: "talk" }, { type: "b-roll", desc: "city, \"night\"" }, { type: "bogus", desc: "x" }] })),
  thumbs: [{ concept: "c1", text: "WOW", prompt: "prompt one" }, { concept: "c2", text: "", prompt: "prompt two" }],
  shorts: [0, 1, 3].map((c) => ({ title: `S${c}`, hook: "h", chapter: c, idea: "i" })),
});
const plan = (perChapter?: number) => validPlan(raw(perChapter)) as LongPlan;

test("validPlan keeps good parts, drops bad shots and duplicate titles, rejects what doesn't fit", () => {
  const p = plan();
  assert.deepEqual(p.titles, ["One", "Two", "Three"]);
  assert.equal(p.chapters[0].shots.length, 2);
  assert.match(validPlan({ ...raw(), chapters: raw().chapters.slice(0, 3) }) as string, /4-8 chapters/);
  assert.match(validPlan({ ...raw(), shorts: [{ title: "x", chapter: 9, idea: "i" }, ...raw().shorts.slice(1)] }) as string, /exactly 3 Shorts/);
  assert.match(validPlan({ ...raw(), thumbs: [] }) as string, /thumbnail/);
  assert.equal(typeof validPlan(null), "string");
});

test("timing: words → seconds at 2.5 wps, Intro at 0:00, chapters back to back", () => {
  assert.equal(words("  a b\n c "), 3);
  assert.equal(speakSec(say(25)), 10);
  assert.equal(speakSec(""), 0);
  const t = chapterTimes(plan());
  assert.deepEqual(t.map((c) => [c.title, c.start, c.sec]), [["Intro", 0, 20], ["Ch 0", 20, 120], ["Ch 1", 140, 120], ["Ch 2", 260, 120], ["Ch 3", 380, 120]]);
  assert.equal(totalSec(plan()), 500);
  assert.equal(stamp(75), "1:15");
  assert.equal(stamp(3725), "1:02:05");
});

test("length check: 8-12 minutes", () => {
  assert.equal(lengthProblem(plan()), "");
  assert.match(lengthProblem(plan(100)), /must be 8-12 minutes/);
  assert.match(lengthProblem(plan(500)), /must be 8-12 minutes/);
});

test("shot list splits each chapter's time across its shots, ends on the chapter end", () => {
  const rows = shotList(plan());
  assert.equal(rows.length, 1 + 4 * 2);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.n, r.ci, r.start, r.end]), [[1, 0, 0, 20], [2, 1, 20, 80], [3, 1, 80, 140]]);
  assert.equal(rows.at(-1)!.end, 500);
});

test("exports: CSV escaping + formula defuse, chapters text, markdown", () => {
  const p = plan();
  const csv = shotCsv(shotList(p)).split("\n");
  assert.equal(csv[0], "shot,chapter,start,end,seconds,type,description");
  assert.equal(csv[3], `3,Ch 0,00:01:20,00:02:20,60,b-roll,"city, ""night"""`);
  assert.match(shotCsv([{ n: 1, ci: 0, chapter: "x", start: 0, end: 1, type: "b-roll", desc: "=HYPERLINK()" }]), /,'=HYPERLINK\(\)$/);
  assert.equal(chaptersText(p).split("\n")[0], "0:00 Intro");
  assert.equal(chaptersText(p).split("\n")[2], "2:20 Ch 1");
  const md = scriptMd({ topic: "t", plan: p });
  assert.match(md, /^# One/);
  assert.match(md, /## 2\. Ch 1 \(2:20\)/);
  assert.match(md, /`1:20` \*\*b-roll\*\*: city/);
  assert.match(md, /\*\*S3\*\* .* from "Ch 3" at 6:20/);
});

test("visuals: thumbnails and b-roll become valid 16:9 drafts; filmed shots are refused", () => {
  const p = plan(), m = { image: "img", video: "vid" };
  const t = visualDraft(p, { kind: "thumb", i: 1 });
  assert.ok(typeof t !== "string");
  assert.deepEqual(validDraft(t.input, m), { kind: "image", prompt: "prompt two", model: "img", count: 1, aspect: "16:9" });
  const s = visualDraft(p, { kind: "shot", ch: 0, i: 1 });
  assert.ok(typeof s !== "string" && s.key === "shot-0-1");
  assert.equal((validDraft(s.input, m) as { kind: string }).kind, "video");
  assert.match(visualDraft(p, { kind: "shot", ch: 0, i: 0 }) as string, /filmed by you/);
  assert.equal(typeof visualDraft(p, { kind: "thumb", i: 7 }), "string");
});
