import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { YUNET, buildTracks, camMask, camWarning, centreOn, decodeYunet, faceFollow, facecamGuess, isFacecam, nms, subjectOf, type Face } from "../src/lib/clips/face-pure.ts";
import { TRACK_H, TRACK_W, frameEnergy, pathAt, smoothPath, type Sample } from "../src/lib/clips/reframe.ts";
import { faceArgs } from "../src/lib/clips/pure.ts";

const face = (x: number, y: number, w = 0.1, h = 0.2, score = 0.9): Face => ({ x, y, w, h, score });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("decodeYunet: OpenCV's cell decoding, padding ignored, low scores and duplicates dropped", () => {
  // 640x384 padded frame of a 640x360 picture; stride 16 has 40 columns. Cell (r=5, c=10): centre (10.5, 5.5)*16, size e^1*16.
  const c = 5 * 40 + 10, b = [0.5, 0.5, 1, 1];
  const faces = decodeYunet([16, c, 0.9, ...b, 16, c, 0.8, 0.55, 0.5, 1, 1, 8, 0, 0.4, 0, 0, 0, 0], 640, 384, 640, 360);
  assert.equal(faces.length, 1); // the 0.8 twin is suppressed, the 0.4 cell is under the threshold
  const w = Math.E * 16;
  assert.ok(near(faces[0].x, (168 - w / 2) / 640) && near(faces[0].y, (88 - w / 2) / 360) && near(faces[0].w, w / 640));
  assert.equal(faces[0].score, 0.9);
  assert.deepEqual(decodeYunet([7, 0, 0.99, 0, 0, 0, 0], 640, 384, 640, 360), []); // unknown stride
});

test("nms keeps the best of overlapping boxes and separate faces", () => {
  const out = nms([face(0.1, 0.1, 0.1, 0.2, 0.8), face(0.105, 0.1, 0.1, 0.2, 0.95), face(0.6, 0.1)]);
  assert.deepEqual(out.map((f) => f.score), [0.95, 0.9]);
});

test("buildTracks links a moving face across small gaps, splits at cuts, keeps two people apart", () => {
  const frames: Face[][] = Array.from({ length: 12 }, (_, i) => (i === 3 || i === 4 ? [] : [face(0.2 + i * 0.01, 0.3), face(0.7, 0.3)]));
  const cuts = frames.map((_, i) => i === 8);
  const tracks = buildTracks(frames, cuts);
  assert.equal(tracks.length, 4); // 2 people x 2 shots
  assert.deepEqual([...tracks[0].at.keys()], [0, 1, 2, 5, 6, 7]);
  assert.deepEqual(tracks.map((t) => t.shot), [0, 0, 1, 1]);
});

test("isFacecam / facecamGuess: a small still face in a corner is the cam; a talking head isn't", () => {
  const cam = Array.from({ length: 20 }, () => [face(0.84, 0.05, 0.06, 0.12)]);
  const [t] = buildTracks(cam, cam.map(() => false));
  assert.ok(isFacecam(t));
  assert.deepEqual(facecamGuess([t])?.side, "tr");
  assert.equal(facecamGuess([t])?.size, 0.25); // face centre at 0.87 → a box 0.26 wide flush right
  const head = buildTracks(Array.from({ length: 20 }, () => [face(0.45, 0.2, 0.12, 0.35)]), Array(20).fill(false));
  assert.ok(!isFacecam(head[0]));
  assert.equal(facecamGuess(head), null);
  const short = buildTracks(cam.slice(0, 4), Array(4).fill(false)); // 1 s isn't enough
  assert.ok(!isFacecam(short[0]));
});

test("subjectOf picks the biggest present face, skips flickers, tiny faces and the facecam", () => {
  const n = 20, cuts = Array(n).fill(false);
  const frames = Array.from({ length: n }, (_, i) => [face(0.84, 0.05, 0.06, 0.12), face(0.3, 0.2, 0.1, 0.25), ...(i < 3 ? [face(0.6, 0.2, 0.3, 0.6)] : []), face(0.5, 0.8, 0.02, 0.04)]);
  const s = subjectOf(buildTracks(frames, cuts), n);
  assert.ok(s && near([...s.at.values()][0].x, 0.3));
  assert.equal(subjectOf(buildTracks(Array.from({ length: n }, () => [face(0.84, 0.05, 0.06, 0.12)]), cuts), n), null);
});

const motion = (n: number, p: number | null, cutAt = -1): Sample[] => Array.from({ length: n }, (_, i) => ({ t: i / 4, p, cut: i === cutAt }));

test("faceFollow: face shots follow the face (gaps hold, late face opens the shot), faceless shots keep motion", () => {
  const n = 24, aspect = 16 / 9, frac = 9 / 16 / aspect;
  const frames = Array.from({ length: n }, (_, i) => (i < 12 ? (i < 2 || i === 6 ? [] : [face(0.7, 0.2, 0.1, 0.3)]) : []));
  const r = faceFollow(motion(n, 0.1, 12), frames, aspect);
  assert.equal(r.faceShots, 1); assert.equal(r.shots, 2);
  const want = centreOn(0.75, frac);
  assert.ok(near(r.samples[0].p!, want) && near(r.samples[5].p!, want), "opens on the face");
  assert.equal(r.samples[6].p, null, "a missing frame holds");
  assert.equal(r.samples[15].p, 0.1, "no face → motion target");
  assert.ok(r.samples[12].cut);
});

test("faceFollow: two big faces that fit are framed together; too far apart → the subject only; facecam ignored", () => {
  const n = 12, aspect = 21 / 9, frac = 9 / 16 / aspect; // frac ≈ 0.24
  const duo = faceFollow(motion(n, null), Array.from({ length: n }, () => [face(0.4, 0.2, 0.06, 0.3, 0.95), face(0.5, 0.2, 0.06, 0.3)]), aspect);
  assert.ok(near(duo.samples[3].p!, centreOn(0.48, frac)));
  const apart = faceFollow(motion(n, null), Array.from({ length: n }, () => [face(0.1, 0.2, 0.07, 0.32), face(0.8, 0.2, 0.06, 0.3)]), aspect);
  assert.ok(near(apart.samples[3].p!, centreOn(0.135, frac)));
  const cam = faceFollow(motion(n, 0.3), Array.from({ length: n }, () => [face(0.02, 0.75, 0.05, 0.12)]), 16 / 9);
  assert.equal(cam.faceShots, 0); assert.equal(cam.cams.length, 1); assert.equal(cam.samples[4].p, 0.3);
});

test("camMask covers the cam's corner box, and masked pixels add no motion energy", () => {
  const m = camMask([face(0.85, 0.05, 0.06, 0.12)])!;
  assert.equal(m[0], 0); assert.equal(m[TRACK_W - 1], 1); assert.equal(m[(TRACK_H - 1) * TRACK_W + TRACK_W - 1], 0);
  assert.equal(camMask([]), undefined);
  const a = new Uint8Array(TRACK_W * TRACK_H), b = new Uint8Array(TRACK_W * TRACK_H).fill(0);
  for (let y = 0; y < 15; y++) for (let x = 140; x < 160; x++) b[y * TRACK_W + x] = 200; // the cam box flickers
  const { energy } = frameEnergy([a, b], TRACK_W, TRACK_H, m);
  assert.equal(energy[1].reduce((s, v) => s + v, 0), 0);
});

test("smoothPath with accel eases in and out, never exceeds the speed limit, lands on target", () => {
  const o = { dead: 0.06, speed: 0.5, accel: 1.5 };
  const keys = smoothPath(Array.from({ length: 40 }, (_, i) => ({ t: i / 4, p: i < 4 ? 0.2 : 0.8 })), o);
  const v = Array.from({ length: 39 }, (_, i) => (pathAt(keys, (i + 1) / 4) - pathAt(keys, i / 4)) * 4);
  assert.ok(v.every((x) => x <= o.speed + 1e-9 && x >= -1e-9), JSON.stringify(v));
  for (let i = 1; i < v.length; i++) assert.ok(Math.abs(v[i] - v[i - 1]) <= o.accel * 0.25 + 1e-9, `jerk at ${i}: ${v[i - 1]} → ${v[i]}`);
  const first = v.find((x) => x > 0)!, last = [...v].reverse().find((x) => x > 0)!;
  assert.ok(first < o.speed && last < o.speed, `eases in (${first}) and out (${last})`);
  assert.ok(near(pathAt(keys, 9.75), 0.8, 0.005), "on target");
  // jitter inside the dead zone: still
  assert.deepEqual(smoothPath(Array.from({ length: 30 }, (_, i) => ({ t: i / 4, p: 0.5 + (i % 2 ? 0.04 : -0.04) })), o).map((k) => k.p), [0.5, 0.5]);
});

test("camWarning: only when the found cam isn't where the split crop is", () => {
  assert.equal(camWarning(null, "tr", 0.3), null);
  assert.equal(camWarning({ side: "tr", size: 0.25 }, "tr", 0.3), null);
  assert.match(camWarning({ side: "bl", size: 0.25 }, "right", 0.3)!, /bottom-left.*camSide bl.*used right$/);
  assert.match(camWarning({ side: "tr", size: 0.5 }, "tr", 0.3)!, /camSize about 0\.5.*tr at 0\.3/);
});

test("faceArgs pads to YuNet strides and keeps the input whitelist", () => {
  const a = faceArgs("a.mp4", 1, 5);
  assert.ok(a.includes("-protocol_whitelist") && a.join(" ").includes("pad=640:'ceil(ih/32)*32':0:0,format=bgr24"));
  assert.equal(YUNET.license, "MIT");
});

// Opt-in: ORBIT_YUNET_MODEL=<path to the .onnx> runs the real worker on a synthetic frame (no face → no detections).
const model = process.env.ORBIT_YUNET_MODEL;
test("real YuNet worker loads and runs", { skip: !(model && existsSync(model)) && "set ORBIT_YUNET_MODEL" }, async () => {
  const { createPool } = await import("../src/lib/asr-pool.ts");
  const p = createPool(new URL("../src/lib/clips/face-worker.mjs", import.meta.url).pathname, 1, 30_000, "YuNet");
  try {
    await p.run({ model }, 60_000);
    const out = (await p.run({ model, frames: new Uint8Array(640 * 384 * 3 * 2).fill(128), w: 640, h: 384, pre: 0.5 }, 60_000)) as Float32Array[];
    assert.equal(out.length, 2);
    assert.deepEqual(decodeYunet(out[0], 640, 384, 640, 360), []);
  } finally { p.close(); }
});
