import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, DEFAULT_URL, MODULES, NOT_RUNNING, VOICES, assetName, cleanTranscript, cloneBlocked, cues, docMarkdown, docMdName, encodeWav, isCaptionLang, isDocName, isMediaName, parseHealth,
  parseIfcSummary, parseTranscript, serviceError, serviceUrl, spacesCsv, toSrt, toVtt, toolState, totalArea, ttsRequest, type Segment } from "../src/lib/local-ai-pure.ts";
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
  assert.deepEqual(h, { running: true, gpu: { name: "NVIDIA GeForce RTX 3060 Laptop GPU", vramGb: 6 }, busy: false, tools: { image3d: true, removebg: false, tts: true, clone: false, captions: false, ifc: false, docs: false } });
  assert.equal(parseHealth(null).running, false);
  assert.equal(parseHealth({ ok: true }).running, false); // some other service on the port
  assert.equal(toolState(parseHealth(null), "tts").text, NOT_RUNNING);
  assert.match(toolState(h, "clone").text, /^Not installed — run .*setup\.ps1/);
  assert.deepEqual(toolState({ ...h, busy: true }, "image3d"), { ok: true, text: "Ready (busy with another job right now)" });
  assert.equal(parseHealth({ ok: true, service: "orbit-local-ai", gpu: { name: 5 } }).gpu, null);
});

test("catalogue: every tool explains itself with model, VRAM, license, where and setup; 3D fits 6 GB", () => {
  for (const id of ["image3d", "removebg", "tts", "clone", "captions", "ifc", "docs", "text3d", "motion"]) {
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
  assert.equal(TIERS.local_transcribe, "T2");
  assert.ok(!isConsequential("local_transcribe") && EFFECTS.local_transcribe === "reversible");
  assert.equal(decide("local_transcribe", { file: "vlog.mp4" }, ctx({ stopAll: true })).allow, false);
  assert.ok(MODULE_HINTS.LOCALAI.test("make captions for my vlog") && MODULE_HINTS.LOCALAI.test("tee subtiitrid"));
  assert.ok(!isConsequential("local_3d") && !isConsequential("local_tts") && EFFECTS.local_tts === "reversible");
  assert.equal(decide("local_tts", { text: "Welcome back!" }, ctx()).allow, true);
  assert.equal(decide("local_3d", { image: "dragon.png" }, ctx({ stopAll: true })).allow, false);
  const journal = `You called life_journal {}\nRESULT:\nToday I felt anxious about the exam and cried a lot.`;
  const d = decide("local_tts", { text: "Today I felt anxious about the exam and cried a lot." }, ctx({ steps: [journal], privateText: ["Today I felt anxious about the exam and cried a lot."] }));
  assert.equal(d.allow, false);
  assert.ok(MODULE_HINTS.LOCALAI.test("turn this picture into a 3D model") && MODULE_HINTS.LOCALAI.test("make a voiceover for my video") && MODULE_ABOUT.LOCALAI);
  assert.ok(!MODULE_HINTS.LOCALAI.test("what's on my calendar today"));
});

test("optional modules: own setup switch, Estonian labels, fit his 8 GB GPU, health and install hint", () => {
  for (const id of MODULES) {
    const c = CATALOG.find((x) => x.id === id)!;
    assert.match(c.setup, /setup\.ps1 -(Captions|Ifc|Docs)$/, id);
    assert.ok(c.et && c.et.name && c.et.what.length > 20, id);
    assert.ok(c.vramGb <= 8, id);
  }
  const h = parseHealth({ ok: true, service: "orbit-local-ai", gpu: null, busy: false, tools: { captions: true, ifc: false } });
  assert.equal(h.tools.captions, true);
  assert.match(toolState(h, "ifc").text, /setup\.ps1 -Ifc$/);
  assert.match(toolState(h, "tts").text, /setup\.ps1$/); // the main tools keep the plain command
});

const seg = (start: number, end: number, text: string, words: [number, number, string][] = []): Segment => ({ start, end, text, words: words.map(([a, b, w]) => ({ start: a, end: b, word: w })) });
test("captions: SRT/VTT timing, long segments split at word times, two short lines per cue", () => {
  const short = [seg(0, 2.5, "Tere tulemast!"), seg(3661.042, 3663, "Welcome back")];
  assert.equal(toSrt(short), "1\n00:00:00,000 --> 00:00:02,500\nTere tulemast!\n\n2\n01:01:01,042 --> 01:01:03,000\nWelcome back\n");
  assert.equal(toVtt(short).split("\n").slice(0, 3).join("|"), "WEBVTT||00:00:00.000 --> 00:00:02.500");
  const words: [number, number, string][] = Array.from({ length: 30 }, (_, i) => [i * 0.5, i * 0.5 + 0.4, ` word${i}`]);
  const long = seg(0, 15, words.map((w) => w[2]).join("").trim(), words);
  const c = cues([long]);
  assert.ok(c.length >= 3, "split into several cues");
  assert.ok(c.every((x) => x.end - x.start <= 7 && x.text.length <= 84), JSON.stringify(c));
  assert.equal(c[0].start, 0); assert.equal(c[c.length - 1].end, 14.9);
  assert.ok(toSrt([long]).split("\n\n").every((block) => block.split("\n").length <= 4), "number, time, at most two text lines");
  assert.ok(!toVtt([seg(0, 1, "a --> b")]).includes("a --> b"), "cue text can't end the timing line");
});

test("captions: transcript cleaning, language and file checks, parse drops bad rows", () => {
  assert.equal(cleanTranscript([seg(0, 1, "Um, so so this is, uh, the plan."), seg(1.2, 2, "next part"), seg(5, 6, "ööö New paragraph.")]),
    "So this is, the plan. next part\n\nNew paragraph.\n");
  assert.ok(isCaptionLang("et") && isCaptionLang("auto") && !isCaptionLang("fi"));
  assert.ok(isMediaName("vlog.MP4") && isMediaName("talk.m4a") && !isMediaName("notes.pdf") && !isMediaName("mp4"));
  const t = parseTranscript({ language: "et", duration: 3, device: "gpu float16", segments: [{ start: 0, end: 1, text: " Tere ", words: [{ start: 0, end: 0.5, word: " Tere" }, { start: "x" }] }, { start: 2, end: 1, text: "bad" }, null] });
  assert.deepEqual(t, { language: "et", duration: 3, device: "gpu float16", segments: [{ start: 0, end: 1, text: "Tere", words: [{ start: 0, end: 0.5, word: " Tere" }] }] });
  assert.equal(parseTranscript({ error: "x" }), null);
  assert.equal(assetName("My Vlog.mp4", "srt", "captions"), "My-Vlog.srt");
});

test("IFC summary: checked shape, total area, CSV escapes quotes and defuses formulas", () => {
  const s = parseIfcSummary({ schema: "IFC4", project: "Maja", storeys: [{ name: "1. korrus", elevation: 0, elements: 12 }],
    spaces: [{ guid: "2O2Fr$t4X7Zf8NOew3FLOH", name: "=HYPERLINK(\"x\")", longName: "Elutuba, köök", storey: "1. korrus", area: 24.5 }, { guid: "g2", name: "WC", longName: "", storey: "1. korrus", area: null }],
    counts: { IfcWall: 4, "bad key": 1, IfcDoor: -1 }, materials: [{ name: "Betoon", elements: 4 }], issues: [{ kind: "space-no-area", text: "Spaces without area", count: 1, examples: ["WC"] }] })!;
  assert.deepEqual(s.counts, { IfcWall: 4 });
  assert.equal(totalArea(s), 24.5);
  assert.equal(spacesCsv(s), "Storey,Space,Long name,Area (m²),GlobalId\r\n1. korrus,\"'=HYPERLINK(\"\"x\"\")\",\"Elutuba, köök\",24.50,2O2Fr$t4X7Zf8NOew3FLOH\r\n1. korrus,WC,,,g2\r\n");
  assert.equal(parseIfcSummary({ error: "no" }), null);
  assert.equal(parseIfcSummary({ schema: "IFC4", spaces: [], storeys: "x" })!.storeys.length, 0);
});

test("document reading: accepted types, .md name beside the original, source header", () => {
  assert.ok(isDocName("Leping.PDF") && isDocName("scan.jpeg") && isDocName("slides.pptx") && !isDocName("notes.md") && !isDocName("old.doc"));
  assert.equal(docMdName("Report 2026.pdf"), "Report-2026.md");
  assert.equal(docMarkdown("a-->b.pdf", "# Title\n", 1), '<!-- Read from VAULT file "ab.pdf" on this PC by Docling (1 page). -->\n\n# Title\n');
});
