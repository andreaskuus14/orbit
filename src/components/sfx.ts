// UI sound layer (plan #3): tiny WebAudio synth, no audio files. Off with the HUD menu's "UI sounds" toggle (orbit.sfx = "0").
// The AudioContext starts on the first sound after a user gesture; browsers block it before that, so early calls are silent no-ops.
let ctx: AudioContext | null = null;
const on = () => { try { return localStorage.getItem("orbit.sfx") !== "0"; } catch { return true; } };
const ac = () => {
  if (!on() || typeof window === "undefined") return null;
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); return ctx.state === "running" ? ctx : null; } catch { return null; }
};

/** One shaped tone: frequency glide f0→f1, attack/decay envelope, optional band-passed noise instead of a sine. */
function tone({ f0, f1 = f0, dur, gain = 0.05, type = "sine", noise = false, q = 1 }: { f0: number; f1?: number; dur: number; gain?: number; type?: OscillatorType; noise?: boolean; q?: number }) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime, g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(a.destination);
  if (noise) {
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(), bp = a.createBiquadFilter();
    src.buffer = buf; bp.type = "bandpass"; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(bp).connect(g); src.start(t); src.stop(t + dur);
  } else {
    const o = a.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur);
  }
}

export const sfx = {
  tick: () => tone({ f0: 2400, f1: 1800, dur: 0.03, gain: 0.02, type: "triangle" }),
  open: () => { tone({ f0: 520, f1: 780, dur: 0.18, gain: 0.035 }); setTimeout(() => tone({ f0: 1040, dur: 0.22, gain: 0.02 }), 70); },
  close: () => tone({ f0: 700, f1: 420, dur: 0.16, gain: 0.03 }),
  whoosh: () => tone({ f0: 300, f1: 2600, dur: 1.1, gain: 0.06, noise: true, q: 2.5 }),
  chime: (urgent = false) => { tone({ f0: urgent ? 880 : 660, dur: 0.35, gain: 0.04 }); setTimeout(() => tone({ f0: urgent ? 1320 : 990, dur: 0.5, gain: 0.03 }), 110); },
  enabled: on,
  set: (v: boolean) => { try { localStorage.setItem("orbit.sfx", v ? "1" : "0"); } catch { /* private mode: stays as is */ } },
};
