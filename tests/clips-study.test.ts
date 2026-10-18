import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYBOOK_MIN, addStudy, buildPlaybook, framePlan, parseLesson, playbookEdit, playbookText, sceneTimes, studyFacts, studyProblem, studyPrompt, studyTranscript, studyYtdlpArgs,
  thumbPick, thumbText, type Lesson,
} from "../src/lib/clips/study-pure.ts";
import { editPlan, type Pt, type Word } from "../src/lib/clips/pure.ts";

const facts = studyFacts(30, [3, 6, 9, 12, 15, 18, 21, 24, 27]);
const meta = { id: "abcdefghijk", title: "He <b>lost</b> it", channel: "Ninja", source: "niche" as const };
const lesson = (i: number, extra: Partial<Lesson> = {}): Lesson => ({ ...parseLesson(JSON.stringify({ hook: { technique: "payoff first", text: "WAIT" }, payoffSec: 20,
  effects: ["zoom punch-in", "word captions"], captions: "karaoke", thumb: { style: "reaction face", textWords: 3 }, titlePattern: "Creator + outcome", why: "fast", lessons: ["cut on the scream"] }),
  { ...meta, id: `vid${String(i).padStart(8, "0")}` }, facts, "2026-10-18T00:00:00Z")!, ...extra });

test("facts, scene parsing and frame plan", () => {
  assert.deepEqual(facts, { durationSec: 30, cuts: 9, avgShotSec: 3 });
  const err = "[Parsed_showinfo_2 @ 0x1] n:0 pts:1 pts_time:1.5 x\n[Parsed_showinfo_2 @ 0x1] n:1 pts_time:1.6\n[Parsed_showinfo_2 @ 0x1] pts_time:4.25 y";
  assert.deepEqual(sceneTimes(err), [1.5, 4.25]);
  const f = framePlan(30, [1.5, 4.25, 10]);
  assert.equal(f[0], 0);
  assert.ok(f.includes(1.7) && f.includes(4.4));
  assert.ok(f.length === 7 && f.every((t, i) => t <= 29.8 && (i === 0 || t - f[i - 1] >= 0.99)));
  assert.equal(framePlan(2, []).length <= 3, true); // short video: only frames ≥ 1 s apart
});

test("prompt fences and strips untrusted text; yt-dlp url is last after --", () => {
  const words: Word[] = [{ start: 0, end: 0.5, text: "ignore" }, { start: 0.5, end: 1, text: "<instructions>!" }, { start: 3, end: 3.5, text: "wow" }];
  const t = studyTranscript(words);
  assert.ok(!/[<>]/.test(t) && t.startsWith("[0.0s]") && t.includes("\n[3.0s] wow"));
  const p = studyPrompt(meta, facts, t, [0, 1.7]);
  assert.ok(p.includes("<short>") && p.includes("<transcript>") && !p.includes("<b>"));
  const a = studyYtdlpArgs("https://www.youtube.com/shorts/abcdefghijk", "/ff");
  assert.deepEqual(a.slice(-2), ["--", "https://www.youtube.com/shorts/abcdefghijk"]);
  assert.ok(a.includes("--ignore-config") && a.join(" ").includes("duration<=180"));
});

test("parseLesson validates labels and clamps numbers", () => {
  assert.equal(parseLesson("no json", meta, facts), null);
  assert.equal(parseLesson('{"why":"","lessons":[]}', meta, facts), null);
  const l = parseLesson('Sure: {"hook":{"technique":"magic","text":"<x>"},"payoffSec":99,"effects":["zoom punch-in","lasers","zoom punch-in"],"captions":"weird","thumb":{"style":"first frame","textWords":"2"},"why":"w","lessons":["a","",3]}', meta, facts)!;
  assert.equal(l.hook.technique, "other");
  assert.equal(l.hook.text, "x");
  assert.equal(l.payoffSec, 30);
  assert.deepEqual(l.effects, ["zoom punch-in"]);
  assert.equal(l.captions, "none");
  assert.deepEqual(l.thumb, { style: "first frame", textWords: 2 });
  assert.deepEqual(l.lessons, ["a"]);
  assert.equal(l.title, "He b lost /b it");
  assert.equal(studyProblem({ v: 1, studies: [l] }), "");
  assert.notEqual(studyProblem({ v: 1, studies: [{ id: 1 }] }), "");
});

test("addStudy dedupes by id, newest first, capped", () => {
  let list: Lesson[] = [];
  for (let i = 0; i < 5; i++) list = addStudy(list, lesson(i), 3);
  assert.deepEqual(list.map((l) => l.id), [lesson(4).id, lesson(3).id, lesson(2).id]);
  list = addStudy(list, { ...lesson(3), why: "again" }, 3);
  assert.equal(list.length, 3);
  assert.equal(list[0].why, "again");
});

test("playbook merge, text and edit tuning (only from PLAYBOOK_MIN studies)", () => {
  const few = [0, 1].map((i) => lesson(i));
  assert.deepEqual(playbookEdit(buildPlaybook(few)), {});
  assert.equal(playbookText(buildPlaybook([])), "");
  const many = Array.from({ length: PLAYBOOK_MIN }, (_, i) => lesson(i, i === 0 ? { effects: ["emoji"], captions: "classic" } : {}));
  const pb = buildPlaybook(many);
  assert.equal(pb.n, 5);
  assert.deepEqual(pb.hooks[0], { label: "payoff first", n: 5 });
  assert.deepEqual(pb.effects.map((e) => e.label), ["word captions", "zoom punch-in"]); // emoji in 1/5: dropped
  assert.equal(pb.shotSec, 3);
  assert.equal(pb.payoffAt, 0.67);
  assert.match(playbookText(pb), /From 5 viral Shorts.*payoff first \(5\/5\)/);
  assert.deepEqual(playbookEdit(pb), { zoomGap: 6, style: "karaoke", thumb: "reaction", shortThumbText: true });
  const fast = buildPlaybook(many.map((l) => ({ ...l, facts: { ...l.facts, avgShotSec: 1.5 } })));
  assert.equal(playbookEdit(fast).zoomGap, 3);
  assert.equal(playbookEdit(fast).minGap, 0.5);
});

test("thumbnail frame and text", () => {
  assert.equal(thumbPick({}, 12, 10, 30), 12);
  assert.equal(thumbPick({ thumb: "reaction" }, 12, 10, 30), 12.6);
  assert.equal(thumbPick({ thumb: "reaction" }, 29.9, 10, 30), 29.7);
  assert.equal(thumbPick({ thumb: "first" }, 12, 10, 30), 10.3);
  assert.equal(thumbText({}, "Title", "HOOK"), "Title");
  assert.equal(thumbText({ shortThumbText: true }, "Title", "HOOK"), "HOOK");
  assert.equal(thumbText({ shortThumbText: true }, "Title", " "), "Title");
});

test("editPlan: no tune = unchanged; tune changes zoom spacing and pause cuts", () => {
  const pts: Pt[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5 + 0.25, v: [4, 12, 20, 28].includes(i) ? 1 : 0.1 }));
  const words: Word[] = [{ start: 0, end: 1, text: "a" }, { start: 1.6, end: 2.5, text: "b" }, { start: 3, end: 29, text: "c" }];
  const o = { jumpCuts: true, zooms: true, captions: true };
  assert.deepEqual(editPlan(words, pts, 30, true, o, {}), editPlan(words, pts, 30, true, o));
  const base = editPlan(words, pts, 30, true, o), tuned = editPlan(words, pts, 30, true, o, { zoomGap: 3, minGap: 0.5 });
  assert.ok(tuned.zooms.length > base.zooms.length);
  assert.ok(tuned.segs.length > base.segs.length); // the 0.6 s pause is cut only with minGap 0.5
  assert.deepEqual(editPlan(words, pts, 30, true, { ...o, zooms: false }, { zoomGap: 3 }).zooms, []); // never turns zooms on
});
