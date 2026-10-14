// Tiny synthesized sound effects (Web Audio, no files). Created lazily on the first user gesture; mute is remembered per browser.
type Sfx = "ore" | "crystal" | "energy" | "upgrade" | "objective" | "warn" | "build" | "win" | "click";
const KEY = "orbit.planet-forge.muted";
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem(KEY, m ? "1" : "0"); } catch { /* storage unavailable: session-only */ }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slide = 0) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export function play(kind: Sfx) {
  if (muted || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { return; }
  switch (kind) {
    case "ore": tone(180 + Math.random() * 30, 0.09, "square", 0.025); break;
    case "crystal": tone(880 + Math.random() * 120, 0.12, "sine", 0.04); break;
    case "energy": tone(420, 0.12, "sawtooth", 0.02, 0, 300); break;
    case "click": tone(600, 0.05, "sine", 0.03); break;
    case "upgrade": [523, 659, 784].forEach((f, i) => tone(f, 0.16, "triangle", 0.05, i * 0.07)); break;
    case "objective": [659, 988].forEach((f, i) => tone(f, 0.22, "sine", 0.05, i * 0.1)); break;
    case "warn": tone(220, 0.35, "sawtooth", 0.04, 0, -120); break;
    case "build": [392, 523, 659].forEach((f, i) => tone(f, 0.2, "triangle", 0.05, i * 0.05)); break;
    case "win": [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, "sine", 0.06, i * 0.14)); break;
  }
}
