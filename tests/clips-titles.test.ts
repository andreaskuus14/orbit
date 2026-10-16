import { test } from "node:test";
import assert from "node:assert/strict";
import { creatorFromSource, parseTitleOptions, thumbTimes, validTitleOptions } from "../src/lib/clips/titles.ts";
import { validateMoments } from "../src/lib/clips/pure.ts";

test("validTitleOptions keeps valid, scored, ≤70-char titles, best first, max 3", () => {
  const long = "x".repeat(71);
  const out = validTitleOptions([
    { text: "  Why did he   do THAT? ", score: 72.6 },
    { text: long, score: 99 }, // too long: dropped, not cut
    { text: "No score", score: "abc" },
    { text: "", score: 50 },
    { text: "why did he do that?", score: 10 }, // duplicate (case-insensitive)
    { text: "He <never> saw it coming", score: 140 },
    { text: "Kai Cenat loses it", score: "64" },
    { text: "Fourth", score: 5 },
    null, "string", 7,
  ]);
  assert.deepEqual(out, [
    { text: "He never saw it coming", score: 100 },
    { text: "Why did he do THAT?", score: 73 },
    { text: "Kai Cenat loses it", score: 64 },
  ]);
  assert.deepEqual(validTitleOptions("nope"), []);
  assert.deepEqual(validTitleOptions(undefined), []);
});

test("parseTitleOptions reads an object or bare array, tolerates prose", () => {
  assert.deepEqual(parseTitleOptions('Sure! {"titles":[{"text":"A","score":-5}]}'), [{ text: "A", score: 0 }]);
  assert.deepEqual(parseTitleOptions('[{"text":"B","score":40}]'), [{ text: "B", score: 40 }]);
  assert.deepEqual(parseTitleOptions("no json"), []);
  assert.deepEqual(parseTitleOptions("[broken"), []);
});

test("validateMoments attaches title options only when valid, single title stays", () => {
  const base = { start: 10, end: 40, title: "Main", hook: "Wait", reason: "r", score: 0.8 };
  const [m] = validateMoments(JSON.stringify([{ ...base, titles: [{ text: "Alt", score: 70 }, { text: "x".repeat(80), score: 90 }] }]), { duration: 100, maxSec: 60, count: 3 });
  assert.equal(m.title, "Main");
  assert.deepEqual(m.titleOptions, [{ text: "Alt", score: 70 }]);
  const [n] = validateMoments(JSON.stringify([{ ...base, titles: "bad" }]), { duration: 100, maxSec: 60, count: 3 });
  assert.equal(n.title, "Main");
  assert.equal("titleOptions" in n, false);
});

test("creatorFromSource reads yt-dlp names only", () => {
  assert.equal(creatorFromSource("Kai_Cenat_-_I_Cant_Believe_This_[dQw4w9WgXcQ].mp4"), "Kai Cenat");
  assert.equal(creatorFromSource("Some One - A title [abcdefghijk].mp4"), "Some One");
  assert.equal(creatorFromSource("my_vod.mp4"), "");
});

test("thumbTimes: existing pick first, then loud peaks spaced apart, inside the clip", () => {
  const rms = new Array(200).fill(0.1); // 100 s at 0.5 s windows
  rms[40] = 0.9; // 20.25 s: the default thumb
  rms[41] = 0.85; // next to it: too close
  rms[60] = 0.8; // 30.25 s
  rms[70] = 0.7; // 35.25 s
  rms[100] = 1; // 50.25 s: outside the clip
  const t = thumbTimes(rms, 15, 45, 20.25);
  assert.deepEqual(t, [20.25, 30.25, 35.25]);
  assert.ok(t.every((x) => x >= 15 && x <= 45));
});

test("thumbTimes: silent clip fills with evenly spaced frames; first is clamped off the cut", () => {
  const t = thumbTimes(new Array(100).fill(0), 10, 30, 10);
  assert.equal(t.length, 3);
  assert.equal(t[0], 10.3);
  assert.ok(t.every((x) => x > 10 && x < 30));
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) assert.ok(Math.abs(t[i] - t[j]) >= 1.5);
  assert.deepEqual(thumbTimes([], 0, 2, 1), [1]); // too short for 3 frames 1.5 s apart: just the one
});
