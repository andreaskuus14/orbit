// Planet UI sound set (reports/design-language.md § Sound): soft, short, synthesised (no audio files, so no licence to check).
// One family: sine/triangle voices on an A-major pentatonic, a 6 ms+ attack and an exponential tail (no clicks), quiet
// (each voice ≤ 0.035 gain before the audio-policy bus). Recipes are data so the runtime (components/ui/sound.ts) and
// the offline renderer below play the same thing; tests render them and check length, loudness and clean ends.
// Rules: the HUD "UI sounds" toggle (orbit.sfx = "0") and the global mute (orbit.mute, audio-policy) silence all of them;
// sounds for frequent actions (tap, menu) are off unless he turns on orbit.sfx.taps = "1". Pure; tests in tests/ui-sound.test.ts.

export type Voice = {
  type: "sine" | "triangle";
  f0: number; f1?: number;  // Hz, exponential glide f0 → f1 over the voice
  at: number;               // start offset, s
  dur: number;              // total length, s (attack + decay)
  gain: number;             // peak gain, 0..1
  attack?: number;          // s, default 0.008
  lowpass?: number;         // Hz, softens the edge (runtime only; the renderer ignores it)
};
export type SoundName = "tap" | "menu" | "toggleOn" | "toggleOff" | "send" | "sheetOpen" | "sheetClose" | "done" | "needs" | "error";

// A-major pentatonic, octaves 4–6: A C# E F# B → calm, never dissonant whatever plays together.
const N = { A4: 440, B4: 493.88, Cs5: 554.37, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, Cs6: 1108.73, E6: 1318.51 } as const;

export const SOUNDS: Record<SoundName, { voices: Voice[]; frequent: boolean; gap: number }> = {
  // frequent (off unless taps are on): barely there
  tap: { frequent: true, gap: 0.04, voices: [{ type: "triangle", f0: N.E6, f1: N.Cs6, at: 0, dur: 0.035, gain: 0.012, attack: 0.006, lowpass: 5000 }] },
  menu: { frequent: true, gap: 0.06, voices: [{ type: "sine", f0: N.B5, at: 0, dur: 0.05, gain: 0.014, attack: 0.006 }] },
  // state changes
  toggleOn: { frequent: false, gap: 0.12, voices: [{ type: "sine", f0: N.A5, f1: N.B5, at: 0, dur: 0.09, gain: 0.026 }] },
  toggleOff: { frequent: false, gap: 0.12, voices: [{ type: "sine", f0: N.B5, f1: N.A5, at: 0, dur: 0.09, gain: 0.022 }] },
  send: { frequent: false, gap: 0.25, voices: [
    { type: "sine", f0: N.E5, at: 0, dur: 0.12, gain: 0.024 },
    { type: "sine", f0: N.B5, at: 0.06, dur: 0.16, gain: 0.02 }] },
  sheetOpen: { frequent: false, gap: 0.2, voices: [{ type: "sine", f0: N.Cs5, f1: N.Fs5, at: 0, dur: 0.16, gain: 0.02, lowpass: 2400 }] },
  sheetClose: { frequent: false, gap: 0.2, voices: [{ type: "sine", f0: N.Fs5, f1: N.Cs5, at: 0, dur: 0.14, gain: 0.018, lowpass: 2400 }] },
  // outcomes: the only "musical" ones, rare by nature
  done: { frequent: false, gap: 0.8, voices: [
    { type: "sine", f0: N.E5, at: 0, dur: 0.32, gain: 0.024 },
    { type: "sine", f0: N.A5, at: 0.07, dur: 0.34, gain: 0.022 },
    { type: "sine", f0: N.Cs6, at: 0.14, dur: 0.42, gain: 0.018 }] },
  needs: { frequent: false, gap: 1.5, voices: [
    { type: "sine", f0: N.A5, at: 0, dur: 0.22, gain: 0.026 },
    { type: "sine", f0: N.E6, at: 0.14, dur: 0.3, gain: 0.02 }] },
  error: { frequent: false, gap: 0.8, voices: [
    { type: "triangle", f0: N.E5, f1: N.Cs5, at: 0, dur: 0.16, gain: 0.022, lowpass: 1600 },
    { type: "triangle", f0: N.Cs5, f1: N.A4, at: 0.12, dur: 0.22, gain: 0.02, lowpass: 1400 }] },
};
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

export const SFX_KEY = "orbit.sfx";        // the existing HUD "UI sounds" toggle (components/sfx.ts): "0" = off, else on
export const TAPS_KEY = "orbit.sfx.taps";  // frequent-action sounds: on only when "1"
export const GLOBAL_GAP = 0.05;           // s: never two sounds closer than this (no stacking on double clicks)

export type SoundGate = {
  sfx: string | null; taps: string | null; // localStorage values
  muted: boolean;                           // orbit.mute / audio policy says 0
  hidden: boolean;                          // tab not visible
  now: number;                              // s
  last: Partial<Record<SoundName, number>>; // when each last played, s
  lastAny: number;                          // s
};

/** May this sound play now? Pure: the runtime passes the current settings and clock. */
export function canPlay(name: SoundName, g: SoundGate): boolean {
  const s = SOUNDS[name];
  if (!s || g.muted || g.hidden || g.sfx === "0") return false;
  if (s.frequent && g.taps !== "1") return false;
  if (g.now - g.lastAny < GLOBAL_GAP) return false;
  const l = g.last[name];
  return l === undefined || g.now - l >= s.gap;
}

/** Total length of a sound, s. */
export const soundLength = (name: SoundName) => Math.max(...SOUNDS[name].voices.map((v) => v.at + v.dur));

/** Gain envelope of one voice at time t (s from the voice's start): linear attack, exponential decay to -80 dB at dur. */
export function envelope(v: Voice, t: number): number {
  const a = Math.max(0.006, v.attack ?? 0.008);
  if (t < 0 || t >= v.dur) return 0;
  if (t < a) return v.gain * (t / a);
  const k = Math.log(1e-4) / (v.dur - a); // reaches gain·1e-4 at the end
  return v.gain * Math.exp(k * (t - a));
}

/** Offline render (mono, no filter): the same voices the runtime plays, for tests and for preview WAVs. */
export function render(name: SoundName, rate = 44100): Float32Array {
  const out = new Float32Array(Math.ceil(soundLength(name) * rate) + 1);
  for (const v of SOUNDS[name].voices) {
    const f1 = v.f1 ?? v.f0, n = Math.ceil(v.dur * rate), start = Math.round(v.at * rate);
    let phase = 0;
    for (let i = 0; i < n && start + i < out.length; i++) {
      const t = i / rate, f = v.f0 * (f1 / v.f0) ** (t / v.dur);
      phase += (2 * Math.PI * f) / rate;
      const w = v.type === "sine" ? Math.sin(phase) : (2 / Math.PI) * Math.asin(Math.sin(phase));
      out[start + i] += w * envelope(v, t);
    }
  }
  return out;
}

/** 16-bit PCM WAV bytes for a rendered sound (preview files in reports/; not shipped). `boost` scales for listening. */
export function toWav(samples: Float32Array, rate = 44100, boost = 1): Uint8Array {
  const b = new ArrayBuffer(44 + samples.length * 2), d = new DataView(b);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); d.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true);
  d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] * boost)) * 32767, true);
  return new Uint8Array(b);
}
