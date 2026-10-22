import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFrameArgs, checkSource, checkTimes, reuploadWarning } from "../src/lib/clips/source-check-pure.ts";

const W = 128, H = 128;
// Deterministic noise-ish moving scene: smooth gradients that shift per frame (few strong edges).
const scene = (i: number) => {
  const f = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = 60 + Math.round(60 * Math.sin((x + i * 23) / 9) * Math.cos((y - i * 17) / 11));
  return f;
};
/** Different white-on-black "words" in a band at y 100..106 (subtitle text changes per frame). */
const addSubs = (f: Uint8Array, i: number) => {
  for (let y = 100; y < 107; y++) for (let x = 20; x < 108; x++) f[y * W + x] = ((x + i * 3) % 4 < 2) ? 255 : 0;
  return f;
};
/** Same small text-like patch in the top right every frame. */
const addMark = (f: Uint8Array) => {
  for (let y = 8; y < 14; y++) for (let x = 96; x < 120; x++) f[y * W + x] = (x % 3 === 0) ? 250 : 10;
  return f;
};
const frames = (fn: (i: number) => Uint8Array) => Array.from({ length: 6 }, (_, i) => fn(i));

test("clean moving footage passes", () => {
  const r = checkSource(frames(scene), W, H);
  assert.equal(r.subtitles, false); assert.equal(r.watermark, false);
  assert.equal(reuploadWarning(r), null);
});

test("burned-in subtitles in the lower third are flagged", () => {
  const r = checkSource(frames((i) => addSubs(scene(i), i)), W, H);
  assert.equal(r.subtitles, true); assert.equal(r.watermark, false);
  assert.equal(reuploadWarning(r), "Looks like a re-upload: burned-in subtitles");
});

test("subtitles in only a couple of frames are not enough", () => {
  const r = checkSource(frames((i) => i < 2 ? addSubs(scene(i), i) : scene(i)), W, H);
  assert.equal(r.subtitles, false);
});

test("a static corner watermark is flagged", () => {
  const r = checkSource(frames((i) => addMark(scene(i))), W, H);
  assert.equal(r.watermark, true);
  assert.equal(reuploadWarning(checkSource(frames((i) => addMark(addSubs(scene(i), i))), W, H)), "Looks like a re-upload: burned-in subtitles + watermark");
});

test("static video, letterbox bars and bad input don't count as a watermark", () => {
  assert.equal(checkSource(frames(() => addMark(scene(0))), W, H).watermark, false); // nothing moves
  const boxed = (i: number) => { const f = scene(i); f.fill(0, 0, W * 20); f.fill(0, W * 108); return f; };
  assert.equal(checkSource(frames(boxed), W, H).watermark, false);
  assert.equal(checkSource([scene(0)], W, H).watermark, false);
  assert.equal(checkSource(frames(() => new Uint8Array(10)), W, H).subtitles, false);
});

test("ffmpeg args and sample times", () => {
  const a = checkFrameArgs("in.mp4", 12.345, "f0.gray");
  assert.deepEqual(a.slice(a.indexOf("-ss"), a.indexOf("-ss") + 2), ["-ss", "12.35"]);
  assert.ok(a.includes("in.mp4") && a.at(-1) === "f0.gray" && a.includes("rawvideo"));
  const t = checkTimes(100);
  assert.equal(t.length, 6); assert.ok(t[0] > 5 && t[5] < 95);
});
