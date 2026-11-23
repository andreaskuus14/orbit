import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPlay, envelope, GLOBAL_GAP, render, SOUND_NAMES, SOUNDS, soundLength, toWav, type SoundGate } from "../src/lib/ui-sound-pure.ts";

const gate = (p: Partial<SoundGate> = {}): SoundGate => ({ sfx: null, taps: null, muted: false, hidden: false, now: 10, last: {}, lastAny: 0, ...p });

test("set: short, quiet, soft", () => {
  for (const n of SOUND_NAMES) {
    assert.ok(soundLength(n) <= 0.6, `${n} is ${soundLength(n)} s`);
    for (const v of SOUNDS[n].voices) {
      assert.ok(v.gain <= 0.035, `${n} voice gain ${v.gain}`);
      assert.ok(v.f0 >= 200 && v.f0 <= 4000 && (v.f1 ?? v.f0) <= 4000, `${n} pitch`);
      assert.ok((v.attack ?? 0.008) >= 0.006, `${n} attack too sharp (clicks)`);
    }
  }
  assert.ok(soundLength("tap") <= 0.05 && soundLength("menu") <= 0.06, "frequent sounds are tiny");
});

test("rendered: no clicks at the ends, no clipping, peak in range, every sound different", () => {
  const seen = new Set<string>();
  for (const n of SOUND_NAMES) {
    const s = render(n);
    let peak = 0, sum = 0;
    for (const x of s) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); sum += x; }
    assert.ok(peak > 0.005 && peak <= 0.06, `${n} peak ${peak}`);
    assert.ok(Math.abs(s[0]) < 1e-3 && Math.abs(s[s.length - 1]) < 1e-3, `${n} starts/ends at silence`);
    assert.ok(Math.abs(sum / s.length) < 1e-3, `${n} has no DC offset`);
    // no jump between neighbouring samples bigger than the waveform itself can make (a click)
    let jump = 0; for (let i = 1; i < s.length; i++) jump = Math.max(jump, Math.abs(s[i] - s[i - 1]));
    assert.ok(jump < 0.02, `${n} max step ${jump}`);
    const sig = Array.from(s.slice(0, 2000)).map((x) => x.toFixed(4)).join();
    assert.ok(!seen.has(sig), `${n} duplicates another sound`); seen.add(sig);
  }
});

test("envelope: zero before and after, peak at the end of the attack", () => {
  const v = { type: "sine" as const, f0: 440, at: 0, dur: 0.2, gain: 0.02, attack: 0.01 };
  assert.equal(envelope(v, -0.01), 0);
  assert.equal(envelope(v, 0.2), 0);
  assert.ok(Math.abs(envelope(v, 0.01) - 0.02) < 1e-9);
  assert.ok(envelope(v, 0.199) < 0.02 * 1e-3);
});

test("rules: HUD toggle off, mute or a hidden tab silence everything", () => {
  for (const n of SOUND_NAMES) {
    assert.equal(canPlay(n, gate({ sfx: "0", taps: "1" })), false);
    assert.equal(canPlay(n, gate({ muted: true, taps: "1" })), false);
    assert.equal(canPlay(n, gate({ hidden: true, taps: "1" })), false);
  }
  assert.equal(canPlay("done", gate()), true, "on by default, like the HUD toggle");
  assert.equal(canPlay("done", gate({ sfx: "1" })), true);
});

test("rules: frequent sounds (tap, menu) only when taps are turned on", () => {
  assert.equal(canPlay("tap", gate()), false);
  assert.equal(canPlay("menu", gate({ taps: "0" })), false);
  assert.equal(canPlay("tap", gate({ taps: "1" })), true);
});

test("rules: no stacking: per-sound gap and a global gap", () => {
  assert.equal(canPlay("done", gate({ last: { done: 9.5 } })), false);
  assert.equal(canPlay("done", gate({ last: { done: 9.1 } })), true);
  assert.equal(canPlay("send", gate({ lastAny: 10 - GLOBAL_GAP / 2 })), false);
  assert.equal(canPlay("send", gate({ lastAny: 10 - GLOBAL_GAP })), true);
});

test("wav: valid 16-bit mono header and length", () => {
  const s = render("done"), w = toWav(s, 44100);
  const d = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...w.slice(8, 12)), "WAVE");
  assert.equal(d.getUint32(24, true), 44100);
  assert.equal(d.getUint16(34, true), 16);
  assert.equal(w.length, 44 + s.length * 2);
});

test("runtime helper follows the rules: it calls canPlay with the HUD key, the taps key and the audio policy", () => {
  const src = readFileSync(new URL("../src/components/ui/sound.ts", import.meta.url), "utf8");
  assert.match(src, /canPlay\(name/);
  assert.match(src, /read\(SFX_KEY\)/);
  assert.match(src, /read\(TAPS_KEY\)/);
  assert.match(src, /audioGains\(\)\.cues/);
  assert.match(src, /subscribeAudio/);
  assert.doesNotMatch(src, /fetch\(|new Audio\(/, "no downloads: everything is synthesised");
});
