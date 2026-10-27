// Spatial ambient sound (roadmap E6): every planet hums its own quiet drone from where it is, the CORE a low hum, and real
// events chime from the planet they belong to. Web Audio only, no files. Rules (mapping, coalescing, mix) live in
// lib/ambient-sound-pure.ts; this module owns the graph. Off until he enables "Ambient sound" in the HUD menu.
import type * as THREE from "three"; // type-only: keeps three.js out of the first-load bundle (Orbit imports this)
import { PLANETS } from "@/lib/planets";
import { SOUND_RANGE } from "@/lib/spatial-sound-pure";
import { admit, AMBIENT_KEY, COALESCE_START, cueFor, DAWN_KEY, dawnDue, HUM_HZ, mix, parseVolume, VOLUME_KEY, voiceFor } from "@/lib/ambient-sound-pure";
import { STOP_ALL_EVENT, STOP_ALL_REQUEST_EVENT, type StopAllDetail } from "@/lib/stop-all-pure";

type Source = { id: string; panner: PannerNode; bus: GainNode; hz: number };
let ctx: AudioContext | null = null, master: GainNode | null = null, hum: GainNode | null = null, listenerParams = false;
const planets: Source[] = [], byId: Record<string, Source> = {};
let coalesce = COALESCE_START, stopAll = false, audible = false, suspendTimer: ReturnType<typeof setTimeout> | undefined;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: this session only */ } };
export const ambientEnabled = () => read(AMBIENT_KEY) === "1";
export const ambientVolume = () => parseVolume(read(VOLUME_KEY));
const running = () => !!ctx && ctx.state === "running" && !document.hidden;

function source(a: AudioContext, id: string, hz: number): Source {
  // HRTF + inverse falloff: full level within SOUND_RANGE, then 8/d.
  const panner = new PannerNode(a, { panningModel: "HRTF", distanceModel: "inverse", refDistance: SOUND_RANGE, rolloffFactor: 1, maxDistance: 200 });
  const bus = a.createGain();
  bus.connect(panner).connect(master!);
  return { id, panner, bus, hz };
}

function build(a: AudioContext) {
  master = a.createGain(); master.gain.value = 0; master.connect(a.destination);
  listenerParams = "positionX" in a.listener; // Firefox: setPosition/setOrientation only
  PLANETS.forEach((p, i) => {
    const v = voiceFor(i, PLANETS.length), s = source(a, p.id, v.hz);
    const drone = a.createGain(), lp = a.createBiquadFilter(), lfo = a.createOscillator(), depth = a.createGain();
    drone.gain.value = v.gain; lp.type = "lowpass"; lp.frequency.value = 900;
    lfo.frequency.value = v.lfoHz; depth.gain.value = v.gain * 0.7; // slow breathing between 0.3× and 1.7×, no JS per frame
    lfo.connect(depth).connect(drone.gain); lfo.start();
    for (const [hz, g] of [[v.hz, 0.6], [v.fifth, 0.4]]) {
      const o = a.createOscillator(), og = a.createGain();
      o.frequency.value = hz; og.gain.value = g; o.connect(og).connect(drone); o.start();
    }
    drone.connect(lp).connect(s.bus);
    planets.push(s); byId[p.id] = s;
  });
  const core = source(a, "core", HUM_HZ * 4); // at the origin (PannerNode default)
  hum = a.createGain(); hum.connect(core.bus);
  for (const [hz, g] of [[HUM_HZ, 0.08], [HUM_HZ * 2, 0.03]]) {
    const o = a.createOscillator(), og = a.createGain();
    o.frequency.value = hz; og.gain.value = g; o.connect(og).connect(hum); o.start();
  }
  byId.core = core;
  addEventListener(STOP_ALL_EVENT, (e) => { stopAll = !!(e as CustomEvent<StopAllDetail>).detail?.on; applyMix(); });
  dispatchEvent(new Event(STOP_ALL_REQUEST_EVENT));
}

/** Creates the graph on first use. Before a user gesture browsers keep it suspended; resumeAmbient() on a gesture starts it. */
function ensure(): AudioContext | null {
  if (ctx || typeof window === "undefined") return ctx;
  try { ctx = new AudioContext(); build(ctx); } catch { ctx = null; }
  return ctx;
}

/** Ramps the master to the pure mix; a silent graph is suspended after the fade so it costs no CPU. */
export function applyMix() {
  if (!ctx || !master || !hum) return;
  const m = mix({ enabled: ambientEnabled(), volume: ambientVolume(), hidden: document.hidden, hour: new Date().getHours(), stopAll });
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(m.master, t, 0.25);
  hum.gain.setTargetAtTime(m.hum, t, 0.6);
  clearTimeout(suspendTimer);
  if (m.master === 0) { audible = false; suspendTimer = setTimeout(() => void ctx?.suspend(), 1500); }
  else if (!audible) { audible = true; void ctx.resume().then(checkDawn, () => {}); } // each time it becomes audible: dawn due?
}

export function resumeAmbient() {
  if (!ambientEnabled() || ctx?.state === "running") return;
  if (ensure()) { audible = false; applyMix(); } // a resume refused before a gesture is retried on this one
}

export function setAmbient(on: boolean) {
  write(AMBIENT_KEY, on ? "1" : "0");
  if (on) ensure();
  applyMix();
}

export function setAmbientVolume(v: number) { write(VOLUME_KEY, String(v)); applyMix(); }

// Pooled: the frame loop allocates nothing. Cloned once from the camera's own Vector3, so no runtime three import here.
let fwd: THREE.Vector3 | undefined, up: THREE.Vector3 | undefined;
/** Called from the galaxy's frame loop: the listener follows the camera, each planet's panner its planet. */
export function frameAmbient(camera: THREE.Camera, positions: Readonly<Record<string, THREE.Vector3>>) {
  if (!ctx || ctx.state !== "running") return;
  const l = ctx.listener, p = camera.position, q = camera.quaternion;
  fwd ??= p.clone(); up ??= p.clone();
  fwd.set(0, 0, -1).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q);
  if (listenerParams) {
    l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
    l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
    l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
  } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  for (let i = 0; i < planets.length; i++) {
    const s = planets[i], v = positions[s.id];
    if (v) { s.panner.positionX.value = v.x; s.panner.positionY.value = v.y; s.panner.positionZ.value = v.z; }
  }
}

function chime(s: Source) {
  const a = ctx!, t = a.currentTime;
  for (const [mult, delay, g] of [[4, 0, 0.05], [6, 0.12, 0.035]]) {
    const o = a.createOscillator(), e = a.createGain();
    o.frequency.value = s.hz * mult;
    e.gain.setValueAtTime(0.0001, t + delay);
    e.gain.exponentialRampToValueAtTime(g, t + delay + 0.03);
    e.gain.exponentialRampToValueAtTime(0.0001, t + delay + 1.8);
    o.connect(e).connect(s.bus); o.start(t + delay); o.stop(t + delay + 1.9);
  }
}

/** A soft A-major swell from the CORE: the night shift is done. */
function dawn() {
  const a = ctx!, t = a.currentTime, g = a.createGain(), core = byId.core;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.035, t + 4);
  g.gain.setValueAtTime(0.035, t + 5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 11);
  g.connect(core.bus);
  for (const hz of [220, 277.18, 329.63, 440]) {
    const o = a.createOscillator(); o.frequency.value = hz; o.connect(g); o.start(t); o.stop(t + 11.1);
  }
  write(DAWN_KEY, new Date().toISOString());
}

/** A realtime `events` row (the same feed the galaxy pulses on). Unmapped, hidden, off or coalesced events are silent. */
export function ambientEvent(type: string, payload?: { status?: unknown } | null) {
  const cue = cueFor(type, payload);
  if (!cue || !running() || !ambientEnabled()) return;
  const r = admit(coalesce, cue, Date.now());
  coalesce = r.state;
  if (!r.play) return;
  if (cue.kind === "dawn") dawn(); else if (byId[cue.source]) chime(byId[cue.source]);
}

/** First open after a finished night shift: one dawn swell, once the graph is actually audible. */
export async function checkDawn() {
  if (!running() || !ambientEnabled()) return;
  const endedAt = await fetch("/api/night").then((r) => (r.ok ? r.json() : null)).then((j: { report?: { endedAt?: string } | null } | null) => j?.report?.endedAt).catch(() => undefined);
  if (dawnDue(endedAt, read(DAWN_KEY)) && running()) dawn();
}
