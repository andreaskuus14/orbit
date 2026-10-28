import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHAPTERS, SETUP, START, STEPS, back, chapterDone, goTo, next, openChapter, parseProgress, position, resume, shouldAutoOpen, skip,
} from "../src/lib/tour-pure.ts";
import { PLANETS } from "../src/lib/planets.ts";

const words = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜÕ“„])/).length;

test("every step has short English and Estonian text, unique ids and a real place", () => {
  const ids = STEPS.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  const panels = new Set<string | null>([null, "core", "profile", ...PLANETS.map((p) => p.id)]);
  for (const st of STEPS) {
    for (const l of ["en", "et"] as const) {
      assert.ok(st.title[l].trim() && st.text[l].trim(), `${st.id} ${l}`);
      assert.ok(words(st.text[l]) <= 2, `${st.id} ${l}: 1–2 sentences`);
    }
    if (st.go) assert.ok(panels.has(st.go.panel), st.id);
  }
  assert.deepEqual(CHAPTERS.map((c) => c.id), ["core", "autonomy", "business", "arch", "galaxy", "phone"]);
});

// GitHub's heading slug: lower case, drop punctuation, spaces → "-".
const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
test("setup hints link to headings that exist in docs/", () => {
  for (const [id, { doc, text }] of Object.entries(SETUP)) {
    const [file, anchor] = doc.split("#");
    const heads = readFileSync(new URL(`../docs/${file}`, import.meta.url), "utf8").split("\n").filter((l) => /^#+ /.test(l)).map((l) => slug(l.replace(/^#+ /, "")));
    assert.ok(heads.includes(anchor), `${id}: #${anchor} not in ${file}`);
    assert.ok(text.en && text.et, id);
  }
  for (const id of ["migrations", "vapid", "shortcuts", "ollama", "capsule", "twilio"]) assert.ok(STEPS.some((x) => x.setup === id), id);
});

test("opens by itself only when nothing is stored; garbage counts as never opened", () => {
  assert.equal(shouldAutoOpen(parseProgress(null)), true);
  assert.equal(shouldAutoOpen(parseProgress("{nope")), true);
  const p = parseProgress(JSON.stringify({ at: "gone", seen: ["missions", "gone", 3, "missions"], closed: true, done: "yes" }))!;
  assert.deepEqual(p, { at: START.at, seen: ["missions"], closed: true, done: false });
  assert.equal(shouldAutoOpen(p), false);
});

test("next, back, chapters, skip and resume", () => {
  let p = goTo(START, START.at);
  assert.deepEqual(p.seen, [STEPS[0].id]);
  assert.equal(back(p).at, STEPS[0].id); // can't go before the first
  p = next(p);
  assert.equal(p.at, STEPS[1].id);
  assert.deepEqual(position(p), { n: 2, total: STEPS.length });

  const arch = CHAPTERS.find((c) => c.id === "arch")!;
  p = openChapter(p, "arch");
  assert.equal(p.at, arch.steps[0].id);
  p = openChapter(next(p), "arch"); // first unseen step of the chapter
  assert.equal(p.at, arch.steps[2].id);

  const s = skip(p);
  assert.equal(s.closed, true);
  assert.equal(s.done, false);
  const r = resume(s);
  assert.equal(r.at, s.at);
  assert.equal(r.closed, false);
  assert.equal(resume(null).at, START.at);

  for (const st of STEPS) p = goTo(p, st.id);
  assert.ok(CHAPTERS.every((c) => chapterDone(p, c)));
  const end = next(p);
  assert.equal(end.done && end.closed, true);
  const again = resume(end); // finished: starts over, keeps the ticks
  assert.equal(again.at, START.at);
  assert.equal(again.done, false);
  assert.ok(chapterDone(again, arch));
});
