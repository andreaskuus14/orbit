import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createPool } from "../src/lib/asr-pool.ts";
import { AUDIO_EVENTS, EVENT_GROUPS, WIN_SEC, audioEventsConfig, eventCurve, eventPieces, eventReason, parseLabelMap, parseWins, wantAudioEvents } from "../src/lib/clips/audio-events-pure.ts";
import { WEIGHTS, fuseSignals, fusedPeaks, topWindows, windowMoments } from "../src/lib/clips/moments-pure.ts";

const WORKER = path.join(import.meta.dirname, "..", "src", "lib", "clips", "audio-events-worker.mjs");
// Lines of the model's class_labels_indices.csv (AudioSet), real indices.
const CSV = `index,mid,display_name
0,/m/09x0r,"Speech"
14,/m/03qc9zr,"Screaming"
16,/m/01j3sz,"Laughter"
19,/m/07s04w4,"Snicker"
21,/m/07rgt08,"Chuckle, chortle"
44,/m/07s0dtb,"Gasp"
63,/m/0l15bq,"Clapping"
66,/m/053hz1,"Cheering"
67,/m/028ght,"Applause"
426,/m/014zdl,"Explosion"
427,/m/032s66,"Gunshot, gunfire"
`;
// Real worker output (zipformer small int8) for a 41 s test track: music, 10 s of laughter at 10-20 s, a stream, applause (CC0 Wikimedia
// Commons "277021 sandermotions applause-2") at 27-34 s, a siren. Windows of 2 s every 1 s; only the event classes with prob ≥ 0.03.
const WINS = JSON.parse(readFileSync(new URL("./fixtures/audio-events-wins.json", import.meta.url), "utf8"));
const labels = parseLabelMap(CSV);

test("the model is pinned: https GitHub release, sha256, Apache-2.0", () => {
  assert.match(AUDIO_EVENTS.url, /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\/audio-tagging-models\/.+\.tar\.bz2$/);
  assert.match(AUDIO_EVENTS.sha256, /^[0-9a-f]{64}$/);
  assert.equal(AUDIO_EVENTS.license, "Apache-2.0");
  assert.ok(AUDIO_EVENTS.files.includes("model.int8.onnx"));
});

test("wantAudioEvents: on unless ORBIT_AUDIO_EVENTS=0/off", () => {
  assert.equal(wantAudioEvents(undefined), true);
  assert.equal(wantAudioEvents(""), true);
  assert.equal(wantAudioEvents("0"), false);
  assert.equal(wantAudioEvents(" OFF "), false);
});

test("audioEventsConfig: int8 zipformer + labels, 1-4 threads, topK = all classes", () => {
  const c = audioEventsConfig("/m/a", 15, (...p) => p.join("/"));
  assert.equal(c.model.zipformer.model, "/m/a/model.int8.onnx");
  assert.equal(c.labels, "/m/a/class_labels_indices.csv");
  assert.equal(c.model.numThreads, 4);
  assert.equal(c.topK, 527);
  assert.equal(audioEventsConfig("/m", 0, (...p) => p.join("/")).model.numThreads, 1);
});

test("parseLabelMap: class index → group from the labels CSV (quoted names with commas included); other classes ignored", () => {
  assert.deepEqual([...labels], [[14, "scream"], [16, "laughter"], [19, "laughter"], [21, "laughter"], [44, "gasp"], [63, "applause"], [66, "cheer"], [67, "applause"], [426, "explosion"], [427, "explosion"]]);
  assert.equal(parseLabelMap("").size, 0);
  assert.equal(parseLabelMap("garbage\nnot,a,csv line").size, 0);
  for (const g of Object.values(EVENT_GROUPS)) assert.ok(g.labels.length && g.weight > 0 && g.weight <= 1);
});

test("parseWins: best class per group, piece offset applied, malformed input skipped", () => {
  const w = parseWins(WINS, labels);
  assert.equal(w.length, 40);
  assert.deepEqual(w[10], { t: 10, p: { laughter: 0.6698 } }); // snicker 0.44 < laughter 0.67
  assert.deepEqual(parseWins(WINS, labels, 100)[10].t, 110);
  assert.deepEqual(parseWins([[0, [[16, 0.5], [19, 0.9]]], [1, [[14, 0.2], [66, 0.7]]]], labels).map((x) => x.p), [{ laughter: 0.9 }, { scream: 0.2, cheer: 0.7 }]);
  assert.deepEqual(parseWins("nope", labels), []);
  assert.deepEqual(parseWins([null, [NaN, []], ["x", []], [1, "no"], [2, [null, [16, "x"], [16, -1], [16, 2]]]], labels), [{ t: 2, p: { laughter: 1 } }]);
});

test("eventPieces: ≤ 60 s pieces overlapping by one hop so every window start is covered once; tiny spans skipped", () => {
  const ps = eventPieces([{ start: 0, end: 130 }]);
  assert.deepEqual(ps, [{ from: 0, to: 60 }, { from: 59, to: 119 }, { from: 118, to: 130 }]);
  const starts = new Set<number>();
  for (const p of ps) for (let s = p.from; s + WIN_SEC <= p.to; s++) starts.add(s);
  assert.deepEqual([...starts].sort((a, b) => a - b), Array.from({ length: 129 }, (_, i) => i)); // 0 … 128 (window 128-130 is the last)
  assert.deepEqual(eventPieces([{ start: 10, end: 11 }]), []);
  assert.deepEqual(eventPieces([{ start: 10, end: 12 }]), [{ from: 10, to: 12 }]);
});

test("eventCurve on the real track: laughter at 10-20 s, applause at 27-34 s, quiet elsewhere, NaN where nothing was tagged", () => {
  const c = eventCurve(parseWins(WINS, labels), 45)!;
  assert.equal(c.curve.length, 45);
  assert.ok(c.curve[11] >= 0.6 && c.top.get(11) === "laughter", `laughter ${c.curve[11]}`);
  assert.ok(c.curve[30] >= 0.9 && c.top.get(30) === "applause", `applause ${c.curve[30]}`);
  assert.ok(c.curve[3] === 0 && c.curve[38] === 0 && !c.top.has(3), "music / siren: no event");
  assert.ok(Number.isNaN(c.curve[42]) && Number.isNaN(c.curve[44]), "past the audio: unknown, not calm");
  assert.equal(eventCurve([], 10), null);
});

test("eventCurve: a second takes the best of the windows covering it; the group weight scales it", () => {
  const c = eventCurve([{ t: 0, p: { laughter: 0.4 } }, { t: 1, p: { gasp: 1 } }], 4)!;
  assert.deepEqual([c.curve[0], c.curve[1], c.curve[2], c.curve[3]].map((x) => (Number.isNaN(x) ? "nan" : Math.round(x * 100) / 100)), [0.4, 0.8, 0.8, "nan"]);
  assert.deepEqual([...c.top], [[0, "laughter"], [1, "gasp"], [2, "gasp"]]);
});

test("eventReason: 'laughter 3.2× avg' style, only when sure (≥ 0.3) and standing out", () => {
  const c = eventCurve(parseWins(WINS, labels), 45)!;
  const r = eventReason(c.curve, c.top, 8, 20)!;
  assert.match(r.text, /^laughter \d+\.\d× avg$/);
  assert.match(eventReason(c.curve, c.top, 26, 34)!.text, /^applause \d+\.\d× avg$/);
  assert.equal(eventReason(c.curve, c.top, 0, 8), null); // nothing there
  assert.equal(eventReason([0, 0.2, 0, 0], new Map([[1, "laughter"]]), 0, 4), null); // not sure enough
  assert.equal(eventReason([0.4, 0.4, 0.4, 0.4], new Map([[1, "laughter"]]), 0, 4), null); // constant: doesn't stand out
});

test("fusion: the event signal joins the weighted mean, its reason is named, and a missing one renormalizes", () => {
  assert.ok(WEIGHTS.event > 0);
  const secs = 60, loud = Array.from({ length: secs }, (_, t) => (t >= 40 && t < 44 ? 10 : 1 + (t % 3) * 0.2)); // a scream-ish loud spike at 40 s
  const ev = new Array<number>(secs).fill(0).map((_, t) => (t >= 10 && t < 14 ? 0.9 : 0.02)), top = new Map<number, string>(ev.map((v, t) => [t, "laughter"] as [number, string]).filter(([t]) => t >= 10 && t < 14));
  const both = fuseSignals({ loud, event: ev }, secs), only = fuseSignals({ loud }, secs);
  assert.deepEqual(both.used, ["loud", "event"]);
  assert.deepEqual(only.used, ["loud"]);
  const w = topWindows(both, { loud, event: ev }, { maxSec: 12, duration: secs, n: 2, minSec: 8, evTop: top });
  assert.equal(w.length, 2);
  const lau = w.find((x) => x.start <= 10 && x.end >= 14)!, scr = w.find((x) => x.start <= 40 && x.end >= 44)!;
  assert.ok(lau && scr, JSON.stringify(w));
  assert.ok(lau.reasons.some((r) => /^laughter \d+\.\d× avg$/.test(r)), lau.reasons.join());
  assert.ok(scr.reasons.includes("scream / loud spike") && !scr.reasons.some((r) => /laughter/.test(r)));
  // Renormalized: where the event signal is unknown (NaN, outside the tagged span) the loud signal carries the second alone.
  const part = ev.map((v, t) => (t < 30 ? v : NaN));
  const f = fuseSignals({ loud, event: part }, secs);
  assert.ok(f.curve[41] > 0.8 * only.curve[41], `loud spike keeps its weight: ${f.curve[41]} vs ${only.curve[41]}`);
  assert.ok(Number.isNaN(f.z.event![41]) && Number.isFinite(f.z.loud![41]));
  // Without any event curve nothing event-related shows up.
  assert.ok(topWindows(only, { loud }, { maxSec: 12, duration: secs, n: 2, minSec: 8 }).every((x) => !x.reasons.some((r) => /laughter|applause|cheering/.test(r))));
  assert.match(windowMoments([lau], 1)[0].reason, /laughter \d+\.\d× avg/);
  assert.ok(Array.isArray(fusedPeaks(both, { loud, event: ev }, 4, undefined, top)));
});

test("a flat event signal (nothing happening) says nothing and drops out", () => {
  const secs = 40, loud = Array.from({ length: secs }, (_, t) => (t === 20 ? 9 : 1 + (t % 2) * 0.1));
  const f = fuseSignals({ loud, event: new Array(secs).fill(0) }, secs);
  assert.deepEqual(f.used, ["loud"]);
});

test("the audio-events worker never loads sherpa in the server process and survives a missing model", async () => {
  const pool = createPool(WORKER, 1, 30_000, "AudioEvents");
  const config = audioEventsConfig(path.join(import.meta.dirname, "no-such-model"), 1, path.join);
  await assert.rejects(pool.run({ config }, 60_000));
  assert.ok(!Object.keys((await import("node:module")).createRequire(import.meta.url).cache).some((k) => k.includes("sherpa-onnx")), "sherpa stays out of this process");
  pool.close();
});

// The real decode needs the 27 MB model: ORBIT_AUDIO_EVENTS_TEST_DIR=<models dir holding zipformer-small-audio-tagging-2024-04-15 (+ test_wavs/4.wav from the release archive)>.
const real = process.env.ORBIT_AUDIO_EVENTS_TEST_DIR;
test("real audio tagging in the child: the model's own laughter wav (opt-in)", { skip: !real || !existsSync(path.join(real, AUDIO_EVENTS.dir, "test_wavs", "4.wav")) }, async () => {
  const { execFileSync } = await import("node:child_process");
  const ff = (await import("ffmpeg-static")).default as unknown as string, dir = path.join(real!, AUDIO_EVENTS.dir);
  const raw = execFileSync(ff, ["-v", "error", "-i", path.join(dir, "test_wavs", "4.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  const lab = parseLabelMap(readFileSync(path.join(dir, "class_labels_indices.csv"), "utf8"));
  const pool = createPool(WORKER, 1, 30_000, "AudioEvents");
  const config = audioEventsConfig(dir, 2, path.join);
  const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const wins = parseWins(await pool.run({ config, want: [...lab.keys()], audio, winSec: 2, hopSec: 1, minProb: 0.03 }, 120_000), lab, 0);
  assert.ok(wins.length >= 8);
  const c = eventCurve(wins, 10)!;
  assert.ok(Math.max(...c.curve.filter(Number.isFinite)) > 0.6, "laughter is heard");
  assert.ok([...c.top.values()].includes("laughter"));
  pool.close();
});
