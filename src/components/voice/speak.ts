"use client";
// CORE's voice: a queue of short utterances on window.speechSynthesis, plus a fake level envelope for the 3D CORE
// (speechSynthesis gives no audio to analyse, so word-boundary events become pulses).
import { voiceLevel, loadVoiceSettings, VOICE_INTERRUPT, type VoiceSettings } from "./bus";

let settings: VoiceSettings | null = null;
let voice: SpeechSynthesisVoice | null = null;
let queue: string[] = [];
let current: SpeechSynthesisUtterance | "kokoro" | null = null; // also keeps Chrome from GC-ing the utterance (then onend never fires)
let waiters: (() => void)[] = [];
const listeners = new Set<(speaking: boolean) => void>();
let pulse = 0, lastWord = 0, raf = 0, voiceAskedAt = 0, stuckSince = 0;
let gen = 0; // bumped by stop(): chunks queued for an older generation are dropped (barge-in while CORE still streams)
let afterCancel = false, scheduled = 0;

/* ---- Natural voice (Kokoro in a worker). Picked as voiceURI "kokoro:<voice>"; any failure falls back to speechSynthesis. ---- */
let worker: Worker | null = null, reqId = 0, kokoroBroken = false;
const pending = new Map<number, (r: { audio?: Float32Array; rate?: number; error?: string; ready?: boolean }) => void>();
let audioCtx: AudioContext | null = null, analyser: AnalyserNode | null = null, source: AudioBufferSourceNode | null = null;
const levelBuf = new Float32Array(1024);
const kokoroVoice = () => { const v = speechSettings().voiceURI; return !kokoroBroken && v?.startsWith("kokoro:") ? v.slice(7) : null; };
function kokoro(text: string, warm = false) {
  if (!worker) {
    worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
    worker.onerror = () => { kokoroBroken = true; pending.forEach((f) => f({ error: "worker failed" })); pending.clear(); };
  }
  const id = ++reqId;
  return new Promise<{ audio?: Float32Array; rate?: number; error?: string }>((res) => {
    pending.set(id, res);
    worker!.postMessage({ id, text, voice: kokoroVoice() ?? "af_heart", speed: Math.min(1.4, Math.max(0.8, Number(speechSettings().rate) || 1)), warm });
  });
}
/** Start loading the model in the background (Settings → Voice picked a natural voice). */
export const warmNaturalVoice = () => { if (typeof Worker !== "undefined") void kokoro("", true); };
let prefetch: { text: string; p: ReturnType<typeof kokoro> } | null = null;
async function speakKokoro(text: string, myGen: number) {
  const got = prefetch?.text === text ? prefetch.p : kokoro(text);
  prefetch = queue[0] !== undefined ? { text: queue[0], p: kokoro(queue[0]) } : null; // make the next sentence while this one plays
  const r = await got;
  if (myGen !== gen || current !== "kokoro") return; // stopped meanwhile
  if (!r.audio || !r.rate) { kokoroBroken = true; current = null; queue.unshift(text); prefetch = null; pump(); return; } // fall back for the rest of the session
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const buf = audioCtx.createBuffer(1, r.audio.length, r.rate);
    buf.copyToChannel(r.audio as Float32Array<ArrayBuffer>, 0);
    analyser ??= Object.assign(audioCtx.createAnalyser(), { fftSize: 1024 });
    analyser.disconnect(); analyser.connect(audioCtx.destination);
    source = audioCtx.createBufferSource(); source.buffer = buf; source.connect(analyser);
    source.onended = () => { if (current !== "kokoro" || myGen !== gen) return; source = null; current = null; pump(); };
    source.start();
  } catch { kokoroBroken = true; current = null; queue.unshift(text); pump(); }
}

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);
export const speechSettings = () => (settings ??= loadVoiceSettings());

function pickVoice() {
  const all = synth()?.getVoices() ?? [];
  const score = (v: SpeechSynthesisVoice) => (/natural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (/^en-(US|GB)/i.test(v.lang) ? 1 : 0);
  voice = all.find((v) => v.voiceURI === speechSettings().voiceURI)
    ?? all.filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] ?? null;
}

if (typeof window !== "undefined") {
  synth()?.addEventListener("voiceschanged", pickVoice); // Chrome loads voices async
  window.addEventListener("orbit:voice-settings", (e) => {
    settings = { ...speechSettings(), ...(e as CustomEvent<VoiceSettings>).detail };
    pickVoice();
    if (!settings.speak) stop();
  });
  window.addEventListener(VOICE_INTERRUPT, () => stop());
  // Listened here (not in CorePanel) because the panel may mount only after the voice question was dispatched.
  window.addEventListener("orbit:voice-asked", () => { voiceAskedAt = Date.now(); });
}

/** True once per voice question (consumed), so a typed question right after it is not spoken. */
export function takeVoiceAsked(ms = 5000) { const r = Date.now() - voiceAskedAt < ms; voiceAskedAt = 0; return r; }
export const speechGen = () => gen;
export const isSpeaking = () => !!current || queue.length > 0;
export function onSpeakingChange(cb: (speaking: boolean) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const notify = () => { const s = isSpeaking(); if (!s) endedAt = Date.now(); listeners.forEach((cb) => cb(s)); };

function pump() {
  const s = synth();
  if (!s || current || scheduled) return;
  if (afterCancel) { // Chrome sometimes drops an utterance spoken right after cancel(): wait a tick
    afterCancel = false;
    scheduled = window.setTimeout(() => { scheduled = 0; pump(); }, 60);
    return;
  }
  const text = queue.shift();
  if (text === undefined) { waiters.forEach((w) => w()); waiters = []; notify(); return; }
  if (kokoroVoice() && typeof Worker !== "undefined") {
    current = "kokoro";
    lastTwo = [...lastTwo.slice(-1), text];
    void speakKokoro(text, gen);
    animate();
    return;
  }
  if (!voice) pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  const rate = Number(speechSettings().rate);
  u.rate = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
  u.onboundary = (e) => { if (e.name !== "sentence") { pulse = 1; lastWord = performance.now(); } };
  u.onend = u.onerror = () => { if (current !== u) return; current = null; pump(); };
  current = u;
  lastTwo = [...lastTwo.slice(-1), text];
  stuckSince = 0;
  s.speak(u);
  if (s.paused) s.resume(); // Chrome can get stuck paused (e.g. after the tab was hidden)
  animate();
}

// What ORBIT said lately, so the mic can tell the user's voice from ORBIT's own voice coming out of the speakers.
// Only the chunk being spoken and the one before (not queued ones, not old answers); cleared by stop().
let lastTwo: string[] = [];
export const spokenText = () => lastTwo.join(" ");
let endedAt = 0;
/** True while ORBIT talks and for tailMs after: the recognizer delivers the end of ORBIT's audio a moment late. */
export const speakingOrJustEnded = (tailMs: number) => isSpeaking() || Date.now() - endedAt < tailMs;

/** Queue one chunk (a sentence; keep it short — Chrome cuts utterances off after ~15 s). */
export function speakChunk(text: string, forGen?: number) {
  if ((!synth() && !kokoroVoice()) || !text.trim() || (forGen !== undefined && forGen !== gen)) return;
  queue.push(text);
  const was = !!current;
  pump();
  if (!was) notify();
}

/** Resolves once everything queued so far has been spoken (or stopped). */
export function finish(): Promise<void> {
  return isSpeaking() ? new Promise((r) => waiters.push(r)) : Promise.resolve();
}

export function stop() {
  queue = [];
  lastTwo = [];
  gen++;
  clearTimeout(scheduled); scheduled = 0;
  afterCancel = true;
  const was = isSpeaking();
  current = null; // before cancel(), so the cancelled utterance's onerror doesn't pump the next one
  synth()?.cancel();
  prefetch = null;
  try { source?.stop(); } catch { /* already ended */ }
  source = null;
  waiters.forEach((w) => w()); waiters = [];
  if (was) notify();
}

// Level envelope: word pulses decaying per frame; a gentle wobble when the voice sends no boundary events.
function animate() {
  if (raf) return;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    pulse *= Math.exp(-dt * 7);
    // Watchdog: Chrome can lose an utterance without firing onend; treat ~1 s of silence as ended.
    const s = synth();
    if (current && current !== "kokoro" && s && !s.speaking && !s.pending) {
      if (!stuckSince) stuckSince = now;
      else if (now - stuckSince > 1000) { stuckSince = 0; current = null; pump(); }
    } else stuckSince = 0;
    const on = !!current;
    const wobble = now - lastWord > 600 ? 0.3 + 0.12 * Math.sin(now / 130) + 0.08 * Math.sin(now / 53) : 0;
    let target = on ? Math.max(0.15 + pulse * 0.85, wobble) : 0;
    if (current === "kokoro") { // real amplitude: RMS of what is playing, so the orb moves with every syllable
      let rms = 0;
      if (analyser && source) { analyser.getFloatTimeDomainData(levelBuf); for (const x of levelBuf) rms += x * x; rms = Math.sqrt(rms / levelBuf.length); }
      target = Math.min(1, rms * 5);
    }
    const v = voiceLevel.speak + (target - voiceLevel.speak) * Math.min(1, dt * 18);
    voiceLevel.speak = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    if (!on && voiceLevel.speak < 0.003) { voiceLevel.speak = 0; raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
