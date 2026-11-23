// The one helper every planet uses for UI sounds: uiSound("done"). Recipes, rules and the offline renderer live in
// lib/ui-sound-pure.ts. Sounds go through their own gain bus that follows the audio policy (global mute → 0, ducked while he
// talks or ORBIT speaks, quieter under a video) and the HUD "UI sounds" toggle. Before the first click browsers keep the
// AudioContext suspended, so early calls are silent no-ops. Nothing is downloaded: every sound is synthesised here.
import { RAMP_S } from "@/lib/audio-policy-pure";
import { canPlay, SFX_KEY, SOUNDS, TAPS_KEY, type SoundName } from "@/lib/ui-sound-pure";
import { audioGains, subscribeAudio } from "../audio-policy";

let ctx: AudioContext | null = null, bus: GainNode | null = null, lastAny = -1;
const last: Partial<Record<SoundName, number>> = {};
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

function context(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); return ctx.state === "running" ? ctx : null; } catch { return null; }
}
function out(a: AudioContext): GainNode {
  if (!bus) {
    bus = a.createGain(); bus.gain.value = audioGains().cues; bus.connect(a.destination);
    subscribeAudio(() => bus!.gain.setTargetAtTime(audioGains().cues, a.currentTime, RAMP_S));
  }
  return bus;
}

/** Play one sound from the set if the settings allow it now. Returns whether it played (for tests in the browser). */
export function uiSound(name: SoundName): boolean {
  if (typeof document === "undefined") return false;
  const cues = audioGains().cues;
  const a0 = ctx; // read the clock without creating a context when the rules already say no
  const now = (a0?.currentTime ?? performance.now() / 1000);
  if (!canPlay(name, { sfx: read(SFX_KEY), taps: read(TAPS_KEY), muted: cues <= 0, hidden: document.visibilityState === "hidden", now, last, lastAny })) return false;
  const a = context();
  if (!a) return false;
  const t0 = a.currentTime + 0.005, dest = out(a);
  for (const v of SOUNDS[name].voices) {
    const t = t0 + v.at, atk = Math.max(0.006, v.attack ?? 0.008), g = a.createGain(), o = a.createOscillator();
    o.type = v.type; o.frequency.setValueAtTime(v.f0, t);
    if (v.f1 && v.f1 !== v.f0) o.frequency.exponentialRampToValueAtTime(v.f1, t + v.dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v.gain, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
    let node: AudioNode = o;
    if (v.lowpass) { const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = v.lowpass; f.Q.value = 0.5; o.connect(f); node = f; }
    node.connect(g).connect(dest); o.start(t); o.stop(t + v.dur + 0.02);
  }
  last[name] = now; lastAny = now;
  return true;
}

/** Frequent-action sounds (tap, menu): off unless he turns them on. The main on/off is the HUD "UI sounds" toggle. */
export const uiTapsOn = () => read(TAPS_KEY) === "1";
export function setUiTaps(on: boolean) { try { localStorage.setItem(TAPS_KEY, on ? "1" : "0"); } catch { /* private mode */ } }
export type { SoundName };
