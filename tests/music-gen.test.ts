import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMusic, clampSeconds, feelOf, MUSIC_FILES, MUSIC_SETUP, musicBase, musicGenOn, musicGraph, musicMeta, musicQueueError, musicSeed, parseAudioHistory, tagsOf } from "../src/lib/music-gen-pure.ts";
import { musicPrompt } from "../src/lib/clips/music-pure.ts";
import { coreToolRefusal } from "../src/lib/stop-all-pure.ts";
import { TIERS, EGRESS_CLASS } from "../src/lib/policy-pure.ts";
import { readFileSync } from "node:fs";

test("seconds clamp to 15-120, junk gets 30", () => {
  assert.equal(clampSeconds(5), 15); assert.equal(clampSeconds(500), 120); assert.equal(clampSeconds("45"), 45); assert.equal(clampSeconds(undefined), 30); assert.equal(clampSeconds(NaN), 30); assert.equal(clampSeconds(37.6), 38);
});

test("graph: built-in ACE-Step 1.5 nodes, turbo settings, instrumental, wired in order", () => {
  const g = musicGraph({ prompt: "calm lo-fi piano", seconds: 999, seed: 7 });
  assert.deepEqual(Object.values(g).map((n) => n.class_type), ["UNETLoader", "DualCLIPLoader", "VAELoader", "ModelSamplingAuraFlow", "TextEncodeAceStepAudio1.5", "ConditioningZeroOut", "EmptyAceStep1.5LatentAudio", "KSampler", "VAEDecodeAudio", "SaveAudioAdvanced"]);
  assert.equal(g["7"].inputs.seconds, 120); assert.equal(g["5"].inputs.duration, 120);
  assert.equal(g["5"].inputs.lyrics, "[Instrumental]"); assert.equal(g["5"].inputs.seed, 7); assert.equal(g["8"].inputs.seed, 7);
  assert.match(String(g["5"].inputs.tags), /^calm lo-fi piano, instrumental, no vocals/);
  assert.deepEqual({ s: g["8"].inputs.steps, c: g["8"].inputs.cfg, sm: g["8"].inputs.sampler_name, sc: g["8"].inputs.scheduler }, { s: 8, c: 1, sm: "euler", sc: "simple" });
  assert.equal(g["4"].inputs.shift, 3); assert.deepEqual(g["8"].inputs.positive, ["5", 0]); assert.deepEqual(g["10"].inputs.audio, ["9", 0]); assert.equal(g["10"].inputs.format, "flac");
  assert.equal(g["1"].inputs.unet_name, MUSIC_FILES[0][1]);
  assert.equal(musicGraph({ prompt: "x y", seconds: 1, seed: 1 })["7"].inputs.seconds, 15);
});

test("prompts: artists, bands, games and 'in the style of' are refused; plain moods pass", () => {
  for (const p of ["epic like Hans Zimmer", "in the style of a famous band", "sounds like Daft Punk", "a Taylor Swift ballad", "feat. someone", "mario theme remix", "Mozart piano"]) assert.ok("error" in checkMusic({ prompt: p }), p);
  for (const p of ["calm warm lo-fi piano and soft pads, 80 bpm", "swift strings, a prince's march", "a queen of hearts waltz"]) assert.ok(!("error" in checkMusic({ prompt: p })), p);
  assert.ok("error" in checkMusic({ prompt: "ab" })); assert.ok("error" in checkMusic({ prompt: "x".repeat(401) }));
  assert.deepEqual(checkMusic({ prompt: "  calm   piano ", seconds: 200, name: "bed" }), { prompt: "calm piano", seconds: 120, name: "bed" });
  assert.ok(!("error" in checkMusic({ prompt: musicPrompt({ idea: "a haunted lighthouse", style: "dark" }) })), "ORBIT's own prompts pass");
});

test("feel, tags, seed, file names, record", () => {
  assert.deepEqual(feelOf("tense dark ambient"), { bpm: 70, keyscale: "D minor" });
  assert.equal(feelOf("something").bpm, 90);
  assert.match(tagsOf("warm pads."), /^warm pads, instrumental, no vocals, background music/);
  assert.equal(musicSeed("a", 30), musicSeed("a", 30)); assert.notEqual(musicSeed("a", 30), musicSeed("a", 31)); assert.equal(musicSeed("a", 5), musicSeed("a", 15));
  assert.equal(musicBase("Calm: lo-fi piano!", 255), "calm-lo-fi-piano-000000ff");
  assert.equal(musicBase("x", 1, "My Bed.flac"), "my-bed-00000001");
  assert.match(musicBase("../../etc/passwd", 1), /^[\w-]+$/);
  const m = musicMeta({ prompt: "p", seconds: 30, seed: 9 }, new Date("2026-11-20T00:00:00Z"));
  assert.equal(m.seed, 9); assert.equal(m.createdAt, "2026-11-20T00:00:00.000Z"); assert.match(m.modelRev, /371bb168/);
  assert.equal(musicGenOn(undefined), true); assert.equal(musicGenOn(" OFF "), false); assert.equal(musicGenOn("1"), true);
});

test("history: pending, done (audio), error, OOM, finished without audio, images ignored", () => {
  assert.deepEqual(parseAudioHistory({}, "a"), { state: "pending" });
  assert.deepEqual(parseAudioHistory({ a: { status: { completed: false }, outputs: {} } }, "a"), { state: "pending" });
  const done = parseAudioHistory({ a: { status: { completed: true }, outputs: { "10": { audio: [{ filename: "m_00001_.flac", subfolder: "orbit", type: "output" }] } } } }, "a");
  assert.deepEqual(done, { state: "done", audio: { filename: "m_00001_.flac", subfolder: "orbit", type: "output" } });
  assert.equal(parseAudioHistory({ a: { outputs: { "1": { audio: [{ filename: "t.flac", type: "temp" }] } } } }, "a").state, "pending");
  const e = parseAudioHistory({ a: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "a");
  assert.ok(e.state === "error" && /ran out of memory/.test(e.error));
  assert.deepEqual(parseAudioHistory({ a: { status: { completed: true }, outputs: { "9": { images: [{ filename: "x.png", type: "output" }] } } } }, "a"), { state: "error", error: "ComfyUI finished without saving any audio." });
});

test("queue errors point at setup; other errors pass through", () => {
  assert.ok(musicQueueError("Value not in list: unet_name: 'acestep_v1.5_turbo.safetensors' not in []").includes(MUSIC_SETUP));
  assert.equal(musicQueueError("Prompt outputs failed validation"), "Prompt outputs failed validation");
  assert.match(MUSIC_SETUP, /setup\.ps1 -Model acestep-music$/);
});

test("local_music: T2 local write, model-egress class, Stop-all refuses it", () => {
  assert.equal(TIERS.local_music, "T2"); assert.equal(EGRESS_CLASS.local_music, "model");
  assert.match(coreToolRefusal(true, "local_music"), /paused/); assert.equal(coreToolRefusal(false, "local_music"), "");
});

test("setup.ps1: the acestep-music block pins every file with sha256 and bytes matching the graph's files", () => {
  const s = readFileSync(new URL("../tools/comfyui/setup.ps1", import.meta.url), "utf8");
  assert.match(s, /"nitrofusion2", "acestep-music"/);
  for (const [dir, f] of MUSIC_FILES) assert.match(s, new RegExp(`InstallModel "${dir}\\\\${f.replace(/\./g, "\\.")}" .*"[0-9a-f]{64}" \\d+`), f);
  assert.match(s, /Comfy-Org\/ACE-Step-1\.5\/resolve\/371bb1680f8c88d8c1083f6ffb6330d3d55bff76\//);
});
