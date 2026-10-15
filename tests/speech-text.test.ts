import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanForSpeech, sentenceStream, speechChunks, splitLong } from "../src/components/voice/speech-text.ts";

test("cleanForSpeech strips Markdown, citations, code and tables", () => {
  assert.equal(cleanForSpeech("## Title\n**Bold** and _it_ with `x` and [docs](https://a.b/c) [1][2] [m:abc-1]."), "Title. Bold and it with x and docs.");
  assert.equal(cleanForSpeech("- one\n* two\n1. three"), "one. two. three.");
  assert.equal(cleanForSpeech("Look:\n```js\nconst a = 1;\n```\nDone."), "Look: Code omitted. Done.");
  assert.equal(cleanForSpeech("| a | b |\n|---|:--:|\n| 1 | 2 |"), "a, b. 1, 2.");
  assert.equal(cleanForSpeech("snake_case_name stays"), "snake_case_name stays.");
  assert.equal(cleanForSpeech("> quote\n---\n"), "quote.");
});

test("sentenceStream emits complete sentences from deltas and keeps the rest", () => {
  const s = sentenceStream();
  const out: string[] = [];
  for (const d of ["Hello wor", "ld. It costs 3.", "5 dollars, e.g. in the U.S. economy", ". See example.com/a.b now! Next"]) out.push(...s.push(d));
  assert.deepEqual(out, ["Hello world.", "It costs 3.5 dollars, e.g. in the U.S. economy.", "See example.com/a.b now!"]);
  assert.deepEqual(s.flush(), ["Next."]);
  assert.deepEqual(s.flush(), []);
});

test("sentenceStream waits for code fences and handles citations after the dot", () => {
  const s = sentenceStream();
  assert.deepEqual(s.push("Fact.[m:x1] More. ```\ncode. here"), ["Fact.", "More."]);
  assert.deepEqual(s.push("\n```\nAfter"), ["Code omitted."]);
  assert.deepEqual(s.flush(), ["After."]);
  s.reset();
  assert.deepEqual(s.flush(), []);
});

test("lists, headings and long sentences become short chunks", () => {
  assert.deepEqual(speechChunks("# Plan\n1. First step\n2. Second step"), ["Plan.", "First step.", "Second step."]);
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const parts = splitLong(long, 100);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 100));
  assert.equal(parts.join(" "), long);
});
