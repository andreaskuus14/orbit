import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cues, dirtyScenes, editScene, fakeVoiceWav, manifestProblems, preflight, sceneAss, sceneHashes, speechFrames, srt, starts, totalFrames, wrap,
  type Manifest, type Probe,
} from "../src/lib/clips/scene-manifest-pure.ts";
import { actingReport, GROUND, rig, sample, type Key } from "../src/lib/clips/stickman-pure.ts";

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const film = (): Manifest => fx("film-bridge-gaps.json");
const edit = fx("film-bridge-gaps-s2-edit.json");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const good = (m: Manifest, w = 1080, h = 1920): Probe => ({ duration: totalFrames(m) / 30, width: w, height: h, fps: "30/1", frames: totalFrames(m), audioStreams: 1, meanDb: -22.7, maxDb: -12.5 });
const failed = (r: ReturnType<typeof preflight>) => r.checks.filter((c) => !c.ok).map((c) => c.id).sort();

test("the fixture is a valid 3-scene manifest of 15-25 s on whole frames", () => {
  const m = film();
  assert.deepEqual(manifestProblems(m), []);
  assert.equal(m.scenes.length, 3);
  assert.deepEqual(starts(m), [0, 180, 375]);
  assert.equal(totalFrames(m), 555); // 18.5 s
  for (const s of m.scenes) for (const k of ["beat", "character", "shot", "line", "audio", "frames", "dependsOn", "version"]) assert.ok(k in s, `${s.id}.${k}`);
});

test("manifestProblems rejects duplicates, off-frame keys, unknown deps, cycles and a line longer than its scene", () => {
  const dup = film(); dup.scenes[1].id = "s1";
  assert.ok(manifestProblems(dup).some((p) => p.includes("duplicate")));
  const off = film(); off.scenes[0].acting[2].f = 21.5;
  assert.ok(manifestProblems(off).some((p) => p.includes("whole frame")));
  const dep = film(); dep.scenes[0].dependsOn = ["nope"];
  assert.ok(manifestProblems(dep).some((p) => p.includes("unknown nope")));
  const cyc = film(); cyc.scenes[0].dependsOn = ["s3"]; cyc.scenes[2].dependsOn = ["s1"];
  assert.ok(manifestProblems(cyc).some((p) => p.includes("cycle")));
  const long = film(); long.scenes[0].line = "This line keeps going and going far past what six seconds can possibly hold for one voice to say out loud";
  assert.ok(manifestProblems(long).some((p) => p.includes("more than the scene leaves")));
  assert.deepEqual(manifestProblems({ v: 2 }).slice(0, 1), ["v must be 1"]);
});

test("editing scene 2 dirties only scene 2; versions bump; reverting hits the old hash again", () => {
  const a = film(), b = editScene(a, edit.scene, edit.patch);
  assert.equal(b.scenes[1].version, 2);
  assert.equal(b.scenes[0].version, 1);
  for (const f of ["vertical", "landscape"] as const) {
    const ha = sceneHashes(a, f), hb = sceneHashes(b, f);
    assert.deepEqual(dirtyScenes(ha, hb), ["s2"]);
    assert.equal(ha.s1, hb.s1); assert.equal(ha.s3, hb.s3);
  }
  const back = editScene(b, "s2", { line: a.scenes[1].line, acting: a.scenes[1].acting });
  assert.equal(back.scenes[1].version, 3);
  assert.deepEqual(sceneHashes(back, "vertical"), sceneHashes(a, "vertical")); // version is not an input
  assert.throws(() => editScene(a, "s9", {}), /no scene s9/);
});

test("dependencies propagate: a scene that depends on scene 2, and every user of an edited character sheet, go dirty", () => {
  const a = film(); a.scenes[2].dependsOn = ["s2"];
  assert.deepEqual(manifestProblems(a), []);
  const b = editScene(a, "s2", { line: "Steel grows on hot days." });
  assert.deepEqual(dirtyScenes(sceneHashes(a, "vertical"), sceneHashes(b, "vertical")), ["s2", "s3"]);
  const c = clone(a); c.assets.pip.color = "#aa2222";
  assert.deepEqual(dirtyScenes(sceneHashes(a, "vertical"), sceneHashes(c, "vertical")), ["s1", "s2", "s3"]);
  assert.notEqual(sceneHashes(a, "vertical").s1, sceneHashes(a, "landscape").s1); // each format is its own render
});

test("fake voice is exactly the scene's length; captions sit on whole frames inside their scene", () => {
  const m = film();
  for (const s of m.scenes) assert.equal(fakeVoiceWav(s.line, 20, s.frames, "fake:pip").length, 44 + s.frames * 1600 * 2);
  assert.ok(fakeVoiceWav("hi there", 0, 30, "v").slice(44).some((x) => x !== 0));
  assert.ok(fakeVoiceWav("", 0, 30, "v").slice(44).every((x) => x === 0));
  const cs = cues(m, "vertical"), st = starts(m);
  assert.equal(cs.length, 3);
  cs.forEach((c, i) => {
    assert.ok(Number.isInteger(c.start) && Number.isInteger(c.end));
    assert.ok(c.start >= st[i] && c.end < st[i] + m.scenes[i].frames, `${c.scene} inside its scene`);
    assert.ok(c.end - c.start >= speechFrames(c.text));
  });
  assert.match(srt(cs), /^1\n00:00:00,800 --> /);
  assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"]);
  assert.match(sceneAss(cs[0], 0, "vertical"), /Dialogue: 0,0:00:00\.80,.*Ever noticed the little\\Ngaps in a bridge\?/);
});

test("acting: the fixture has anticipation, holds and eased big moves; controls without them fail", () => {
  for (const s of film().scenes) assert.ok(actingReport(s.acting, s.frames).ok, s.id);
  const slide: Key[] = [{ f: 0, pose: "neutral" }, { f: 20, pose: "point-up", ease: "linear" }];
  const r = actingReport(slide, 40);
  assert.equal(r.linearBig, 1); assert.equal(r.anticipations, 0); assert.equal(r.ok, false);
  assert.deepEqual(actingReport([{ f: 0 }, { f: 10.5 }], 30).offFrame, [10.5]);
});

test("stickman: holds outside keys, overshoot on back easing, head and forearms trail, feet stay planted", () => {
  const keys: Key[] = [{ f: 0, pose: "neutral" }, { f: 10, pose: "point-up", ease: "back" }];
  assert.deepEqual(sample(keys, -5), sample(keys, 0));
  assert.equal(sample(keys, 40).uaR, 122);
  const peak = Math.max(...Array.from({ length: 14 }, (_, f) => sample(keys, f).uaR));
  assert.ok(peak > 122, "overshoots, then settles");
  assert.ok(sample(keys, 11).head !== 14 && sample(keys, 12).head === 14, "head lands 2 frames late");
  assert.ok(sample(keys, 12).faR !== 4 && sample(keys, 13).faR === 4, "forearm lands 3 frames late");
  for (const dy of [0, 20]) {
    const r = rig({ ...sample(keys, 0), dy }, 300, 1);
    for (const seg of [r.segs[6], r.segs[8]]) assert.equal(seg[1][1], GROUND);
    const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(Math.abs(len(r.segs[5][0], r.segs[5][1]) - 105) < 1e-6 && Math.abs(len(r.segs[6][0], r.segs[6][1]) - 100) < 1, "limb lengths kept");
  }
});

test("preflight passes the fixture in both formats from one manifest", () => {
  const m = film();
  assert.deepEqual(failed(preflight(m, "vertical", good(m))), []);
  assert.deepEqual(failed(preflight(m, "landscape", good(m, 1920, 1080))), []);
});

test("preflight failing controls: an extra frame, wrong fps/size, no audio, clipping, missing asset, unsafe actor, covered actor", () => {
  const m = film();
  assert.deepEqual(failed(preflight(m, "vertical", { ...good(m), frames: 556, duration: 18.54 })), ["duration", "frames"]);
  assert.deepEqual(failed(preflight(m, "vertical", { ...good(m), fps: "25/1", width: 720 })), ["fps", "resolution"]);
  assert.deepEqual(failed(preflight(m, "vertical", { ...good(m), audioStreams: 0, meanDb: null, maxDb: null })), ["audio-level", "audio-stream"]);
  assert.deepEqual(failed(preflight(m, "vertical", { ...good(m), meanDb: -9, maxDb: 0 })), ["audio-level"]);
  assert.deepEqual(failed(preflight(m, "vertical", good(m), ["cache/scene-x.mp4"])), ["assets"]);
  const edge = clone(m); edge.scenes[0].home = 960;
  assert.ok(failed(preflight(edge, "vertical", good(edge))).includes("safe-actor"));
  const wordy = clone(m); wordy.scenes[1].frames = 450;
  wordy.scenes[1].line = "On really hot summer days the long steel deck of a bridge grows a little longer, and in winter it shrinks back again, so it needs room";
  const r = failed(preflight(wordy, "vertical", good(wordy)));
  assert.ok(r.includes("captions-clear-of-actor"), r.join());
  const silent = clone(m); silent.scenes.forEach((s) => (s.audio = { kind: "silence" }));
  assert.ok(failed(preflight(silent, "vertical", good(silent))).includes("captions-present"));
  const slide = clone(m); slide.scenes[2].acting = [{ f: 0, pose: "neutral" }, { f: 30, pose: "hands-hips", ease: "linear" }];
  assert.ok(failed(preflight(slide, "vertical", good(slide))).includes("acting"));
});

test("style A: long shadow lies on the ground, stretched away from the low sun", async () => {
  const { shadowPoint, GROUND } = await import("../src/lib/clips/stickman-pure.ts");
  assert.deepEqual(shadowPoint([300, GROUND], 0.9), [300, GROUND]); // feet stay put
  const [x, y] = shadowPoint([300, GROUND - 400], 0.9);
  assert.ok(x > 600 && y >= GROUND && y < GROUND + 40);
});

test("real voice: placed at its frame, mouth follows its loudness", async () => {
  const { pcmWav, mouthFromPcm, RATE, FPS } = await import("../src/lib/clips/scene-manifest-pure.ts");
  const pcm = new Int16Array(RATE / 2).map((_, i) => (i < RATE / 4 ? 8000 : 0)); // 0.25 s loud, 0.25 s silent
  const wav = pcmWav(pcm, 30, 60), v = new DataView(wav.buffer);
  assert.equal(wav.length, 44 + 2 * RATE * 2);
  assert.equal(v.getInt16(44 + (RATE - 1) * 2, true), 0); // before frame 30: silence
  assert.equal(v.getInt16(44 + RATE * 2, true), 8000);
  const m = mouthFromPcm(pcm, 30, 60);
  assert.equal(m[29], 0); assert.equal(m[30], 1); assert.equal(m[30 + FPS / 4 + 1], 0);
});
