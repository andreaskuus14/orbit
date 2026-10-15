"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { voiceLevel, VOICE_ASK, VOICE_INTERRUPT } from "./bus";
import { normalizeTranscript } from "./wake";

/** Dispatched by Orbit right before a voice question is handed to CORE; the spoken-answers code reads answers aloud only then. */
export const VOICE_ASKED = "orbit:voice-asked";
/** Push-to-talk tells "Hey Orbit" to release the mic now (synchronously), and to resume when it is done. */
export const VOICE_PAUSE = "orbit:voice-pause";
export const VOICE_RESUME = "orbit:voice-resume";

// Minimal Web Speech API types (not in TS's DOM lib).
type SpeechAlt = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; [i: number]: SpeechAlt };
export type SpeechResultEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
export type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecCtor = new () => SpeechRec;

export function getSpeechRecognition(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const speechLang = () => (typeof navigator !== "undefined" && navigator.language) || "en-US";

/** Friendly text for a SpeechRecognition error code; null for ones the user doesn't need to see. */
export function speechErrorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed": case "service-not-allowed": return "Microphone access is blocked. Allow it from the icon in the address bar, then try again.";
    case "no-speech": return "I didn't hear anything. Click the mic and try again.";
    case "audio-capture": return "No microphone found. Check that one is plugged in and selected in Windows.";
    case "network": return "Voice input needs an internet connection (Chrome sends audio to Google to transcribe).";
    case "language-not-supported": return `Voice input doesn't support ${speechLang()} here.`;
    case "aborted": return null;
    default: return "Voice input stopped unexpectedly. Try again.";
  }
}

const SILENCE_MS = 1500;

/** Mic loudness meter: writes a smoothed 0..1 level into voiceLevel.mic each frame. Returns a stop function. */
function startMeter(): () => void {
  let stopped = false, raf = 0, stream: MediaStream | null = null, ctx: AudioContext | null = null;
  const release = () => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    stream = null; ctx = null; voiceLevel.mic = 0;
  };
  navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => {
    stream = s;
    if (stopped) return release(); // stopped before the permission prompt resolved
    ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let level = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const target = Math.min(1, Math.sqrt(sum / buf.length) * 5); // normal speech RMS ≈ 0.05–0.2
      level += (target - level) * (target > level ? 0.5 : 0.12); // fast attack, slow release
      voiceLevel.mic = level;
      raf = requestAnimationFrame(tick);
    };
    tick();
  }).catch(() => { /* meter is cosmetic; recognition reports permission errors itself */ });
  return () => { stopped = true; release(); };
}

export type VoiceInput = {
  supported: boolean; listening: boolean; interim: string; error: string;
  start(): void; stop(): void; cancel(): void; toggle(): void; clearError(): void;
};

/** Push-to-talk speech recognition. A finished utterance is dispatched as VOICE_ASK { text }. */
export function useVoiceInput(): VoiceInput {
  const [supported, setSupported] = useState(true); // assume yes for SSR; corrected on mount
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const session = useRef<{ rec: SpeechRec; cancelled: boolean; stopMeter: () => void } | null>(null);

  useEffect(() => { setSupported(!!getSpeechRecognition()); }, []);

  const stop = useCallback(() => { session.current?.rec.stop(); }, []);
  const cancel = useCallback(() => {
    const s = session.current;
    if (!s) return;
    s.cancelled = true;
    s.rec.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) { setError("Voice input isn't supported in this browser. Use Chrome or Edge."); return; }
    if (session.current) return;
    const rec = new Ctor();
    rec.lang = speechLang();
    rec.continuous = true; // we end the utterance ourselves after SILENCE_MS
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const s = { rec, cancelled: false, stopMeter: () => {} };
    session.current = s;
    let finalText = "", silence = 0 as unknown as ReturnType<typeof setTimeout>, heard = false;

    rec.onresult = (e) => {
      if (!heard) { heard = true; dispatchEvent(new Event(VOICE_INTERRUPT)); }
      let fin = "", tmp = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else tmp += r[0].transcript;
      }
      finalText = normalizeTranscript(fin);
      setInterim(normalizeTranscript(fin + " " + tmp));
      clearTimeout(silence);
      silence = setTimeout(() => rec.stop(), SILENCE_MS);
    };
    rec.onerror = (e) => { if (!s.cancelled) { const m = speechErrorMessage(e.error); if (m) setError(m); } };
    rec.onend = () => {
      clearTimeout(silence);
      s.stopMeter();
      session.current = null;
      setListening(false);
      setInterim("");
      dispatchEvent(new Event(VOICE_RESUME));
      if (!s.cancelled && finalText) dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: finalText } }));
    };

    setError("");
    setInterim("");
    dispatchEvent(new Event(VOICE_PAUSE)); // wake mode aborts its recognition before ours starts: Chrome allows one at a time
    try { rec.start(); } catch { session.current = null; dispatchEvent(new Event(VOICE_RESUME)); setError("Couldn't start voice input. Try again."); return; }
    s.stopMeter = startMeter();
    setListening(true);
    dispatchEvent(new Event(VOICE_INTERRUPT)); // clicking the mic means "I want to talk": stop any spoken answer
  }, []);

  const toggle = useCallback(() => { if (session.current) stop(); else start(); }, [start, stop]);
  const clearError = useCallback(() => setError(""), []);

  useEffect(() => () => { const s = session.current; if (s) { s.cancelled = true; s.rec.abort(); s.stopMeter(); } }, []);

  return { supported, listening, interim, error, start, stop, cancel, toggle, clearError };
}
