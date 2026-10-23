import { test } from "node:test";
import assert from "node:assert/strict";
import { lessonNote, lessonScene, parseLesson, quizScore, LESSON_MAX } from "../src/lib/arch-lesson-pure.ts";

const reply = JSON.stringify({
  building: "Villa Savoye", architect: "Le Corbusier", year: 1931, place: "Poissy, France",
  chapters: [
    { title: "Pilotis", text: "The house stands on thin columns.", ops: [
      { op: "add", id: "col1", kind: "wall", name: "Pilotis", x: -4, z: 0, w: 0.2, d: 0.2, h: 3 },
      { op: "add", kind: "pool", w: 1, d: 1, h: 1 }, // unknown kind: dropped
      { op: "add", id: "bad id!", kind: "slab", w: 20, d: 20, h: 0.3, y: 3 }, // bad id: auto-named
    ], focus: ["col1", 7] },
    { title: "The box", text: "A white box floats above.", ops: [
      { op: "add", id: "box", kind: "wall", w: 20, d: 20, h: 3 },
      { op: "add", kind: "window", host: "box", face: "s", w: 12 },
      { op: "set", id: "col1", h: 3.2 },
    ] },
    { title: "", text: "no title: dropped", ops: [] },
  ],
  quiz: [
    { q: "What lifts the house?", options: ["Pilotis", "A plinth", "A hill", "Stilts of wood"], answer: 0, why: "Point 1 of the five points." },
    { q: "Three options only", options: ["a", "b", "c"], answer: 0, why: "" },
    { q: "Bad answer", options: ["a", "b", "c", "d"], answer: 4, why: "" },
  ],
});

test("parseLesson keeps valid chapters, ops and quiz items and drops the rest", () => {
  const l = parseLesson(`Here you go: ${reply}`)!;
  assert.equal(l.building, "Villa Savoye");
  assert.equal(l.year, "1931");
  assert.equal(l.chapters.length, 2);
  assert.equal(l.chapters[0].ops.length, 2);
  assert.deepEqual(l.chapters[0].ids, ["col1", undefined]);
  assert.deepEqual(l.chapters[0].focus, ["col1"]);
  assert.equal(l.quiz.length, 1);
  assert.equal(parseLesson("no json"), null);
  assert.equal(parseLesson(JSON.stringify({ building: "", chapters: [{ title: "a", text: "b" }] })), null);
});

test("limits: chapter count, words per chapter, quiz length", () => {
  const long = Array.from({ length: 200 }, () => "word").join(" ");
  const q = { q: "?", options: ["a", "b", "c", "d"], answer: 1, why: "" };
  const l = parseLesson(JSON.stringify({ building: "X", chapters: Array.from({ length: 12 }, (_, i) => ({ title: `c${i}`, text: long })), quiz: Array(9).fill(q) }))!;
  assert.equal(l.chapters.length, LESSON_MAX.chapters);
  assert.equal(l.chapters[0].text.split(" ").length, LESSON_MAX.words);
  assert.equal(l.quiz.length, LESSON_MAX.quiz);
});

test("lessonScene builds chapter by chapter from an empty plot, with the lesson's ids", () => {
  const l = parseLesson(reply)!;
  const s0 = lessonScene(l, 0);
  assert.deepEqual(s0.parts.map((p) => p.id), ["col1", "l1"]);
  const s1 = lessonScene(l, 1);
  assert.equal(s1.parts.find((p) => p.id === "col1")!.h, 3.2);
  const win = s1.parts.find((p) => p.kind === "window")!;
  assert.equal(win.host, "box");
  assert.equal(lessonScene(l, -1).parts.length, l.chapters[0].ops.length); // clamps to the first chapter
});

test("quiz score and the saved note", () => {
  const l = parseLesson(reply)!;
  assert.equal(quizScore(l.quiz, [0]), 1);
  assert.equal(quizScore(l.quiz, [null]), 0);
  const n = lessonNote(l, [0]);
  assert.equal(n.title, "Precedent: Villa Savoye");
  assert.match(n.content, /Le Corbusier · 1931 · Poissy/);
  assert.match(n.content, /## Pilotis/);
  assert.match(n.content, /Quiz: 1\/1/);
  assert.doesNotMatch(lessonNote(l, [null]).content, /Quiz/);
});
