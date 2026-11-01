import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, DEFAULT_URL, NOT_RUNNING, VOICES, assetName, cloneBlocked, encodeWav, parseHealth, serviceError, serviceUrl, toolState, ttsRequest } from "../src/lib/local-ai-pure.ts";
import { decide, TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { EFFECTS, isConsequential } from "../src/lib/approval-pure.ts";
import { MODULE_ABOUT, MODULE_HINTS } from "../src/lib/core-modules-pure.ts";

test("service URL: only plain http on this PC; anything else is refused", () => {
  assert.equal(serviceUrl(undefined), DEFAULT_URL);
  assert.equal(serviceUrl(""), DEFAULT_URL);
  assert.equal(serviceUrl("http://localhost:9000/x"), "http://localhost:9000");
  assert.equal(serviceUrl("http://[::1]:7861"), "http://[::1]:7861");
  for (const bad of ["https://example.com", "http://192.168.1.5:7861", "http://127.0.0.1.evil.com", "http://user:pw@127.0.0.1:7861", "file:///c:/x", "not a url"]) assert.equal(serviceUrl(bad), null, bad);
});

test("health: server.py's JSON → tools; unreachable or foreign JSON = not running", () => {
  const h = parseHealth({ ok: true, service: "orbit-local-ai", gpu: { name: "NVIDIA GeForce RTX 3060 Laptop GPU", vramGb: 6 }, busy: false, tools: { image3d: true, tts: true, clone: "yes" } });
  assert.deepEqual(h, { running: true, gpu: { name: "NVIDIA GeForce RTX 3060 Laptop GPU", vramGb: 6 }, busy: false, tools: { image3d: true, removebg: false, tts: true, clone: false } });
  assert.equal(parseHealth(null).running, false);
  assert.equal(parseHealth({ ok: true }).running, false); // some other service on the port
  assert.equal(toolState(parseHealth(null), "tts").text, NOT_RUNNING);
  assert.match(toolState(h, "clone").text, /^Not installed — run .*setup\.ps1/);
  assert.deepEqual(toolState({ ...h, busy: true }, "image3d"), { ok: true, text: "Ready (busy with another job right now)" });
  assert.equal(parseHealth({ ok: true, service: "orbit-local-ai", gpu: { name: 5 } }).gpu, null);
});

test("catalogue: every tool explains itself with model, VRAM, license, where and setup; 3D fits 6 GB", () => {
  for (const id of ["image3d", "removebg", "tts", "clone", "text3d", "motion"]) {
    const c = CATALOG.find((x) => x.id === id);
    assert.ok(c && c.what.length > 20 && c.model && c.vram && c.license && c.where && c.setup, id);
  }
  assert.ok(CATALOG.every((c) => c.vramGb <= 6), "nothing in the list needs more than his 6 GB");
});

test("tts request mirrors server.py: script required, length cap, preset voices only", () => {
  assert.deepEqual(ttsRequest("  Hi there ", undefined), { text: "Hi there", voice: VOICES[0].id });
  assert.deepEqual(ttsRequest("Hi", "bm_george"), { text: "Hi", voice: "bm_george" });
  assert.ok("error" in ttsRequest("", "af_heart"));
  assert.ok("error" in ttsRequest("x".repeat(5001), "af_heart"));
  assert.match((ttsRequest("Hi", "someone_else") as { error: string }).error, /Unknown voice/);
});

test("own-voice cloning: consent box, his own sample, its transcript and a short take are all required", () => {
  const ok = { consent: true, sampleBytes: 1000, sampleText: "This is me talking.", text: "Welcome to the channel." };
  assert.equal(cloneBlocked(ok), "");
  assert.match(cloneBlocked({ ...ok, consent: false }), /own voice/);
  assert.match(cloneBlocked({ ...ok, sampleBytes: 0 }), /sample of your own voice/);
  assert.match(cloneBlocked({ ...ok, sampleText: " " }), /exactly what you said/);
  assert.match(cloneBlocked({ ...ok, text: "x".repeat(601) }), /at most 600/);
});

test("asset names: safe VAULT names with the right extension", () => {
  assert.equal(assetName("Golden Dragon Pet.png", "glb", "model-3d"), "Golden-Dragon-Pet.glb");
  assert.equal(assetName("../../etc/passwd", "wav", "voiceover"), "etcpasswd.wav");
  assert.equal(assetName("", "png", "cutout"), "cutout.png");
  assert.equal(assetName(undefined, "glb", "model-3d"), "model-3d.glb");
  assert.equal(assetName("ä".repeat(100), "glb", "m").length, 64);
});

test("service errors keep server.py's plain message", () => {
  assert.equal(serviceError(409, { error: "Busy with another job." }), "Busy with another job.");
  assert.equal(serviceError(422, { detail: [{ msg: "x" }] }), "Local AI failed (error 422).");
  assert.equal(serviceError(500, null), "Local AI failed (error 500).");
});

test("encodeWav: a valid mono 16-bit RIFF header and clamped samples", () => {
  const w = encodeWav(new Float32Array([0, 1, -1, 2]), 24000), v = new DataView(w.buffer);
  assert.equal(new TextDecoder().decode(w.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(w.subarray(8, 16)), "WAVEfmt ");
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)], [0, 32767, -32767, 32767]);
});

const ctx = (o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: "make a voiceover", ...o });
test("CORE tools: T2 local writes, reversible, halted by Stop-all, routed by hints; journal text never reaches the TTS model", () => {
  assert.equal(TIERS.local_3d, "T2");
  assert.equal(TIERS.local_tts, "T2");
  assert.ok(!isConsequential("local_3d") && !isConsequential("local_tts") && EFFECTS.local_tts === "reversible");
  assert.equal(decide("local_tts", { text: "Welcome back!" }, ctx()).allow, true);
  assert.equal(decide("local_3d", { image: "dragon.png" }, ctx({ stopAll: true })).allow, false);
  const journal = `You called life_journal {}\nRESULT:\nToday I felt anxious about the exam and cried a lot.`;
  const d = decide("local_tts", { text: "Today I felt anxious about the exam and cried a lot." }, ctx({ steps: [journal], privateText: ["Today I felt anxious about the exam and cried a lot."] }));
  assert.equal(d.allow, false);
  assert.ok(MODULE_HINTS.LOCALAI.test("turn this picture into a 3D model") && MODULE_HINTS.LOCALAI.test("make a voiceover for my video") && MODULE_ABOUT.LOCALAI);
  assert.ok(!MODULE_HINTS.LOCALAI.test("what's on my calendar today"));
});
