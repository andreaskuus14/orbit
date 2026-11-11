import { test } from "node:test";
import assert from "node:assert/strict";
import { acestepArgv, musicPrompt } from "../src/lib/clips/music-pure.ts";

test("music prompt: instrumental, no vocals, mood from the story", () => {
  assert.match(musicPrompt({ idea: "a haunted lighthouse", style: "dark" }), /tense, dark ambient/);
  assert.match(musicPrompt({ idea: "a pear's revenge", style: "cartoon", format: "drama" }), /playful/);
  assert.match(musicPrompt({ idea: "how bridges work", style: "clean" }), /calm, warm lo-fi piano/);
  for (const p of [musicPrompt({ idea: "x", style: "y" })]) assert.match(p, /instrumental.*no vocals/);
});

test("ACE-Step command: placeholders fill single arguments (no shell injection), seconds clamped, {out} required", () => {
  const a = acestepArgv('python "C:\\ace dir\\gen.py" --prompt {prompt} --duration {seconds} --output {out}', { prompt: 'calm; rm -rf / "x"', seconds: 999, out: "/tmp/m.wav" })!;
  assert.deepEqual(a, ["python", "C:\\ace dir\\gen.py", "--prompt", 'calm; rm -rf / "x"', "--duration", "240", "--output", "/tmp/m.wav"]);
  assert.equal(acestepArgv("python gen.py --prompt {prompt}", { prompt: "x", seconds: 30, out: "o" }), null, "no {out}: refused");
  assert.equal(acestepArgv("{out}", { prompt: "x", seconds: 30, out: "o" }), null);
  assert.equal(acestepArgv("gen --s {seconds} -o {out}", { prompt: "x", seconds: 3, out: "o" })![2], "10");
});
