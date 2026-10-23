import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALIEN_GLYPHS, FLASH_LEAD, glyphFor, isDecodable, lockTimes, MONO_GLYPHS, newPool, primeAssemble, primeDisperse, samplePoints, stepAssemble, stepDisperse, textSeed,
} from "../src/lib/decode-pure.ts";

test("lock times run left to right inside the budget, with a stagger, deterministic", () => {
  const l = lockTimes(10, 750, 42);
  assert.equal(l.length, 10);
  for (let i = 1; i < l.length; i++) assert.ok(l[i] > l[i - 1], "strictly increasing");
  assert.ok(l[0] >= 750 * 0.28 && l[9] <= 750 && l[9] > 600);
  const gaps = l.slice(1).map((v, i) => v - l[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 5, "not an even metronome");
  assert.deepEqual(lockTimes(10, 750, 42), l);
  assert.deepEqual(lockTimes(0, 750), []);
  assert.ok(lockTimes(3, NaN).every((v) => v === 0));
});

test("glyphs: alien far from the lock, mono just before it, stable per tick", () => {
  assert.ok(ALIEN_GLYPHS.includes(glyphFor(1, 0, 3, 500)));
  assert.ok(MONO_GLYPHS.includes(glyphFor(1, 0, 3, FLASH_LEAD - 1)));
  assert.equal(glyphFor(9, 2, 5, 400), glyphFor(9, 2, 5, 400));
  const seen = new Set(Array.from({ length: 40 }, (_, t) => glyphFor(9, 2, t, 400)));
  assert.ok(seen.size > 8, "it cycles");
  assert.ok(isDecodable("A") && isDecodable("7") && !isDecodable(" ") && !isDecodable("·") && !isDecodable("+"));
  assert.equal(textSeed("MEMORY"), textSeed("MEMORY"));
  assert.notEqual(textSeed("MEMORY"), textSeed("VAULT"));
});

const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = on(x, y) ? 255 : 0;
  return d;
};

test("samplePoints finds the ink, stays inside it and respects the cap", () => {
  const w = 60, h = 20, d = mask(w, h, (x) => x >= 10 && x < 30), out = new Float32Array(2000);
  const n = samplePoints(d, w, h, 2, 1000, out);
  assert.equal(n, 10 * 10);
  for (let i = 0; i < n; i++) assert.ok(out[i * 2] >= 9 && out[i * 2] < 31 && out[i * 2 + 1] >= -1 && out[i * 2 + 1] < 21);
  assert.equal(samplePoints(d, w, h, 2, 37, out), 37);
  assert.equal(samplePoints(d, w, h, 2, 1000, new Float32Array(10)), 5, "never writes past out");
  assert.equal(samplePoints(mask(w, h, () => false), w, h, 2, 100, out), 0);
  assert.equal(samplePoints(d, 0, h, 2, 100, out), 0);
});

test("assembly streams out of the origin, settles on the letterforms; dispersal fades out", () => {
  const p = newPool(200);
  p.n = 50;
  for (let i = 0; i < p.n; i++) { p.tx[i] = 100 + i * 4; p.ty[i] = 300; }
  primeAssemble(p, 100, 200, 800, 100);
  assert.ok(p.a.every((a) => a === 0));
  let far = stepAssemble(p, 0, 1 / 60, 800, 100);
  assert.equal(far, 50, "nobody has arrived at t=0");
  const x0 = p.x[0]; // still at the origin, moving with it
  stepAssemble(p, 0, 0, 820, 100);
  assert.ok(Math.abs(p.x[0] - x0 - 20) < 1e-3 || p.delay[0] === 0);
  let t = 0;
  for (; t < 2 && far > 0; t += 1 / 60) far = stepAssemble(p, t, 1 / 60, 800, 100);
  assert.equal(far, 0);
  assert.ok(t < 0.6, `settles in time (${t.toFixed(2)} s)`);
  assert.ok(p.a[0] > 0.99);
  // left letters leave first, on average
  const avg = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += p.delay[i]; return s / (b - a); };
  assert.ok(avg(0, 10) < avg(40, 50));

  primeDisperse(p, 200, 300);
  let vis = p.n;
  for (t = 0; t < 2 && vis > 0; t += 1 / 60) vis = stepDisperse(p, t, 1 / 60);
  assert.equal(vis, 0);
  assert.ok(t < 1.2, `gone in time (${t.toFixed(2)} s)`);
  assert.ok(Math.abs(p.x[0] - 100) > 20, "moved out");
});
