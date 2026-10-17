// "Remember my voice": a rough local voice profile (spectral envelope + median pitch) so open mic can ignore a TV or
// other people. Not a security lock. Audio never leaves the browser; only the profile numbers go to localStorage.
// The math is pure (tested in tests/voice-print.test.ts); the sampler/storage touch the DOM only when called.

export type VoiceProfile = { env: number[]; pitch: number | null };
export type Frame = { t: number; env: number[]; pitch: number | null };
/** sensitivity 0 = Off, else 0..1 (higher = stricter). */
export type VoicePrint = { profile: VoiceProfile | null; sensitivity: number };

const BANDS = 20, F_LO = 100, F_HI = 4000, MIN_FRAMES = 8;

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** Analyser dB spectrum (getFloatFrequencyData) → log-spaced band levels with the mean removed, so loudness and mic
 *  distance don't matter, only the shape. */
export function bandEnvelope(db: ArrayLike<number>, sampleRate: number): number[] {
  const binHz = sampleRate / 2 / db.length, out: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    const i0 = Math.max(1, Math.floor(F_LO * (F_HI / F_LO) ** (b / BANDS) / binHz));
    const i1 = Math.max(i0 + 1, Math.ceil(F_LO * (F_HI / F_LO) ** ((b + 1) / BANDS) / binHz));
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += Number.isFinite(db[i]) ? Math.max(-140, db[i]) : -140;
    out.push(sum / (i1 - i0));
  }
  const mean = out.reduce((a, v) => a + v, 0) / BANDS;
  return out.map((v) => v - mean);
}

/** Fundamental frequency by normalised autocorrelation (70–400 Hz); null when the frame isn't voiced. */
export function pitchHz(x: ArrayLike<number>, sampleRate: number): number | null {
  const lo = Math.floor(sampleRate / 400), hi = Math.min(Math.floor(sampleRate / 70), x.length - 2);
  const c: number[] = [];
  let best = 0;
  for (let l = lo; l <= hi + 1; l++) {
    let d = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + l < x.length; i++) { d += x[i] * x[i + l]; e1 += x[i] * x[i]; e2 += x[i + l] * x[i + l]; }
    c[l] = e1 && e2 ? d / Math.sqrt(e1 * e2) : 0;
    if (l <= hi) best = Math.max(best, c[l]);
  }
  if (best < 0.5) return null;
  // First peak near the best, not the best itself: 2× the period correlates just as well (octave error).
  for (let l = lo + 1; l <= hi; l++) {
    if (c[l] >= 0.9 * best && c[l] >= c[l - 1] && c[l] >= c[l + 1]) {
      const den = c[l - 1] - 2 * c[l] + c[l + 1];
      return sampleRate / (l + (den ? (c[l - 1] - c[l + 1]) / (2 * den) : 0));
    }
  }
  return null;
}

/** Voiced frames → profile (mean envelope, median pitch); null when there was too little speech to judge. */
export function summarize(frames: Frame[]): VoiceProfile | null {
  if (frames.length < MIN_FRAMES) return null;
  const env = Array.from({ length: BANDS }, (_, b) => frames.reduce((a, f) => a + f.env[b], 0) / frames.length);
  const p = frames.map((f) => f.pitch).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { env, pitch: p.length >= 3 ? p[p.length >> 1] : null };
}

/** 0..1: envelope shape similarity, blended with pitch closeness (half an octave apart scores 0). */
export function matchScore(me: VoiceProfile, heard: VoiceProfile): number {
  const env = Math.max(0, cosine(me.env, heard.env));
  if (me.pitch === null || heard.pitch === null) return env;
  return 0.6 * env + 0.4 * Math.max(0, 1 - Math.abs(Math.log2(heard.pitch / me.pitch)) / 0.5);
}
export const matchThreshold = (sensitivity: number) => 0.5 + 0.4 * sensitivity;

const KEY = "orbit.voiceprint";
export function loadVoicePrint(): VoicePrint {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<VoicePrint>;
    const env = o.profile?.env, pitch = o.profile?.pitch;
    const profile = Array.isArray(env) && env.length === BANDS && env.every(Number.isFinite)
      ? { env, pitch: typeof pitch === "number" && Number.isFinite(pitch) && pitch > 0 ? pitch : null } : null;
    return { profile, sensitivity: profile && typeof o.sensitivity === "number" ? Math.min(1, Math.max(0, o.sensitivity)) : 0 };
  } catch { return { profile: null, sensitivity: 0 }; }
}
export function saveVoicePrint(v: VoicePrint) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: the profile just isn't kept */ }
  window.dispatchEvent(new CustomEvent("orbit:voiceprint", { detail: v }));
}

/** One enrollment at a time (the popover can remount mid-recording). */
export const enrollment = { on: false };
/** Every mic stream ORBIT opens: the browser's echo cancellation keeps ORBIT's own voice out. */
export const MIC: MediaStreamConstraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };

/** An AudioContext made without a click starts suspended (reads silence). Resume now if allowed, else on the next
 *  pointerdown/keydown; onChange(suspended) reports the state. Returns a cleanup. Never awaited: resume() can hang. */
export function resumeOnGesture(ctx: AudioContext, onChange: (suspended: boolean) => void = () => {}): () => void {
  const kick = () => { void ctx.resume().catch(() => {}); };
  const report = () => onChange(ctx.state === "suspended");
  kick();
  addEventListener("pointerdown", kick, true);
  addEventListener("keydown", kick, true);
  ctx.addEventListener("statechange", report);
  report();
  return () => { removeEventListener("pointerdown", kick, true); removeEventListener("keydown", kick, true); ctx.removeEventListener("statechange", report); };
}

/** A second mic tap (Chrome's recognizer gives no audio): keeps the last 20 s of voiced frames, skipping while skip() is
 *  true (ORBIT talking). features(since) summarises frames from that time on. */
export function startVoiceSampler(skip: () => boolean = () => false) {
  let frames: Frame[] = [], stopped = false, timer: ReturnType<typeof setInterval> | undefined;
  let stream: MediaStream | null = null, ctx: AudioContext | null = null, live: (v: boolean) => void = () => {}, unhook = () => {};
  const ready = new Promise<boolean>((r) => { live = r; }); // true once audio flows (enrollment waits for it)
  const release = () => { clearInterval(timer); unhook(); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => {}); stream = null; ctx = null; };
  const media = navigator.mediaDevices?.getUserMedia(MIC) ?? Promise.reject(new Error("no mic"));
  media.then(async (s) => {
    stream = s;
    if (stopped) return release();
    ctx = new AudioContext();
    unhook = resumeOnGesture(ctx);
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]); // enrollment (a click) resumes at once
    if (stopped) return release();
    const an = ctx.createAnalyser();
    an.fftSize = 2048; an.smoothingTimeConstant = 0;
    try { ctx.createMediaStreamSource(s).connect(an); } catch { release(); live(false); return; }
    const td = new Float32Array(an.fftSize), fd = new Float32Array(an.frequencyBinCount), rate = ctx.sampleRate;
    let floor = 0.01, n = 0; // noise floor: falls fast, rises slowly, so speech stands out on any mic gain
    timer = setInterval(() => {
      an.getFloatTimeDomainData(td);
      let sum = 0;
      for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
      const rms = Math.sqrt(sum / td.length);
      floor = rms < floor ? floor * 0.8 + rms * 0.2 : floor * 0.995 + rms * 0.005;
      if (skip() || rms < Math.max(0.006, floor * 2.5)) return;
      an.getFloatFrequencyData(fd);
      const now = Date.now();
      frames.push({ t: now, env: bandEnvelope(fd, rate), pitch: n++ % 2 ? null : pitchHz(td.subarray(0, 1024), rate) }); // pitch on every 2nd frame: it's the costly part
      while (frames.length && frames[0].t < now - 20_000) frames.shift();
    }, 50);
    live(ctx.state === "running");
  }).catch(() => { live(false); /* no mic for the sampler: callers treat "no features" as "can't tell" */ });
  return {
    ready,
    /** Audio is actually flowing: a live track and a running context (a suspended one reads silence). */
    get ok() { return !stopped && !!stream?.getAudioTracks().some((t) => t.readyState === "live") && ctx?.state === "running"; },
    features: (since = 0) => summarize(frames.filter((f) => f.t >= since)),
    reset() { frames = []; },
    stop() { stopped = true; release(); live(false); },
  };
}
