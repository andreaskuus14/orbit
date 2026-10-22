import { test } from "node:test";
import assert from "node:assert/strict";
import { coreParticleSide, newCoreState, stepCore, waveAmp, VOICE_HOLD, type CoreInput } from "../src/lib/particle-core-pure.ts";

const quiet: CoreInput = { busy: false, mic: 0, speak: 0, warning: false };
const run = (inp: CoreInput, secs: number, s = newCoreState()) => { for (let t = 0; t < secs; t += 1 / 60) s = stepCore(s, inp, 1 / 60); return s; };
const ok = (w: number[]) => { assert.ok(w.every((x) => Number.isFinite(x) && x >= 0)); assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-9); };

test("particle count scales with quality and is off below high", () => {
  assert.equal(coreParticleSide(0), 0);
  assert.equal(coreParticleSide(1), 0);
  assert.equal(coreParticleSide(2) ** 2, 16384);
  assert.ok(coreParticleSide(3) ** 2 > 16384 && coreParticleSide(3) ** 2 <= 65536);
});

test("shapes blend over about a second, busy beats voice", () => {
  const voice = run({ ...quiet, speak: 0.5 }, 1);
  ok(voice.w);
  assert.ok(voice.w[1] > 0.9, "waveform after 1 s of talking");
  const half = run({ ...quiet, speak: 0.5 }, 0.3);
  assert.ok(half.w[1] > 0.3 && half.w[1] < 0.9, "still blending at 0.3 s");
  const busy = run({ ...quiet, busy: true, mic: 1 }, 1);
  assert.ok(busy.w[2] > 0.9);
});

test("waveform holds through short pauses, then relaxes to the sphere", () => {
  const talking = run({ ...quiet, mic: 0.6 }, 1);
  const pause = run(quiet, VOICE_HOLD * 0.7, talking);
  assert.ok(pause.w[1] > 0.9);
  const later = run(quiet, VOICE_HOLD + 1.5, talking);
  assert.ok(later.w[0] > 0.9);
});

test("garbage input stays finite", () => {
  const s = stepCore({ w: [NaN, -1, Infinity], hold: NaN, red: NaN }, { busy: false, mic: NaN, speak: -3, warning: true }, NaN);
  ok(s.w);
  assert.ok(Number.isFinite(s.red) && Number.isFinite(s.hold));
  const r = run({ ...quiet, warning: true }, 1);
  assert.ok(r.red > 0.9 && r.red <= 1);
  assert.ok(Number.isFinite(waveAmp(NaN, NaN)) && waveAmp(1, 0) > waveAmp(0, 0));
});
