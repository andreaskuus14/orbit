"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadVoiceSettings, recognizerFor, voiceContext, voiceLevel, VOICE_ASK, VOICE_INTERRUPT } from "./bus";
import { normalizeTranscript } from "./wake";
import { correctTranscript, mergeFinals, pickBestAlternative } from "./hear";
import { recordUtterance, transcribeAudio } from "./whisper";

/** Dispatched by Orbit right before a voice question is handed to CORE; the spoken-answers code reads answers aloud only then. */
export const VOICE_ASKED = "orbit:voice-asked";
/** Push-to-talk tells "Hey Orbit" to release the mic now (synchronously), and to resume when it is done. */
export const VOICE_PAUSE = "orbit:voice-pause";
export const VOICE_RESUME = "orbit:voice-resume";
/** "Hey Orbit" heard a bare wake word in Local Whisper mode: push-to-talk records the question with Whisper. */
export const VOICE_LISTEN = "orbit:voice-listen";

// Minimal Web Speech API types (not in TS's DOM lib).
type SpeechAlt = { transcript: string };
export type SpeechResult = { isFinal: boolean; length: number; [i: number]: SpeechAlt };
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
/** Set explicitly (voice settings): Chrome otherwise follows the browser's UI language, which may not be the spoken one. */
export const speechLang = () => loadVoiceSettings().lang || "en-US";
export const alternatives = (r: SpeechResult) => Array.from({ length: r.length }, (_, k) => r[k].transcript);

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
  const session = useRef<{ stop(): void; cancel(): void } | null>(null);

  useEffect(() => { setSupported(!!getSpeechRecognition() || !!navigator.mediaDevices?.getUserMedia); }, []); // no Chrome recognizer: Whisper still works

  const stop = useCallback(() => { session.current?.stop(); }, []);
  const cancel = useCallback(() => { session.current?.cancel(); }, []);

  const start = useCallback(() => {
    if (session.current) return;
    const whisper = recognizerFor(loadVoiceSettings(), "pushToTalk") === "whisper"; // always Whisper in local-only hands-free
    const Ctor = whisper ? null : getSpeechRecognition();
    if (!whisper && !Ctor) { setError("Voice input isn't supported in this browser. Use Chrome or Edge."); return; }
    let cancelled = false, ended = false;
    const end = (text: string) => {
      if (ended) return;
      ended = true;
      session.current = null;
      setListening(false);
      setInterim("");
      dispatchEvent(new Event(VOICE_RESUME));
      if (!cancelled && text) dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));
    };
    setError("");
    setInterim("");
    dispatchEvent(new Event(VOICE_PAUSE)); // wake mode aborts its recognition before ours starts: Chrome allows one at a time

    if (!Ctor) {
      const ctrl = new AbortController();
      let finishRecording = () => {};
      session.current = { stop: () => finishRecording(), cancel: () => { cancelled = true; ctrl.abort(); end(""); } };
      setListening(true);
      dispatchEvent(new Event(VOICE_INTERRUPT));
      void (async () => {
        try {
          const audio = await recordUtterance(ctrl.signal, (f) => { finishRecording = f; });
          if (!audio) { if (!cancelled) setError("I didn't hear anything. Click the mic and try again."); return end(""); }
          setInterim("Transcribing…");
          end(correctTranscript(await transcribeAudio(audio, ctrl.signal)));
        } catch (e) {
          if (!cancelled) setError(e instanceof DOMException && e.name === "NotAllowedError" ? speechErrorMessage("not-allowed")!
            : e instanceof Error ? e.message : "Voice input stopped unexpectedly. Try again.");
          end("");
        }
      })();
      return;
    }

    const rec = new Ctor();
    rec.lang = speechLang();
    rec.continuous = true; // we end the utterance ourselves after SILENCE_MS
    rec.interimResults = true;
    rec.maxAlternatives = 5; // pickBestAlternative chooses (commands and the wake word win)
    let finalText = "", silence: ReturnType<typeof setTimeout> | undefined, heard = false, stopMeter = () => {};
    session.current = { stop: () => rec.stop(), cancel: () => { cancelled = true; rec.abort(); } };

    rec.onresult = (e) => {
      if (!heard) { heard = true; dispatchEvent(new Event(VOICE_INTERRUPT)); }
      const fin: string[] = [];
      let tmp = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin.push(pickBestAlternative(alternatives(r), voiceContext)); else tmp += r[0].transcript;
      }
      finalText = mergeFinals(fin);
      setInterim(normalizeTranscript(finalText + " " + tmp));
      clearTimeout(silence);
      silence = setTimeout(() => rec.stop(), SILENCE_MS);
    };
    rec.onerror = (e) => { if (!cancelled) { const m = speechErrorMessage(e.error); if (m) setError(m); } };
    rec.onend = () => { clearTimeout(silence); stopMeter(); end(finalText); };

    try { rec.start(); } catch { session.current = null; dispatchEvent(new Event(VOICE_RESUME)); setError("Couldn't start voice input. Try again."); return; }
    stopMeter = startMeter();
    setListening(true);
    dispatchEvent(new Event(VOICE_INTERRUPT)); // clicking the mic means "I want to talk": stop any spoken answer
  }, []);

  const toggle = useCallback(() => { if (session.current) stop(); else start(); }, [start, stop]);
  const clearError = useCallback(() => setError(""), []);

  useEffect(() => {
    addEventListener(VOICE_LISTEN, start);
    return () => removeEventListener(VOICE_LISTEN, start);
  }, [start]);
  useEffect(() => () => session.current?.cancel(), []);

  return { supported, listening, interim, error, start, stop, cancel, toggle, clearError };
}
