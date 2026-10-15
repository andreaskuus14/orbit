"use client";
import { useEffect, useState } from "react";
import { VOICE_ASK, VOICE_INTERRUPT } from "./bus";
import { getSpeechRecognition, speechErrorMessage, speechLang, VOICE_PAUSE, VOICE_RESUME, type SpeechRec } from "./useVoiceInput";
import { extractWakeQuestion, isSleepCommand, normalizeTranscript } from "./wake";

const AWAY_MS = 60_000; // window unfocused this long → stop listening
const ARMED_MS = 8000; // after a bare "Hey Orbit", how long the next utterance counts as the question

/** Hands-free "Hey Orbit": continuous recognition while enabled, not paused, the tab visible and the window focused within the last minute. */
export function useWakeWord(enabled: boolean, paused: boolean) {
  const [state, setState] = useState<"off" | "listening" | "armed">("off");
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(true);
  const [away, setAway] = useState(false);
  const [held, setHeld] = useState(false); // push-to-talk has the mic

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    on();
    document.addEventListener("visibilitychange", on);
    let t: ReturnType<typeof setTimeout> | undefined;
    const blur = () => { clearTimeout(t); t = setTimeout(() => setAway(true), AWAY_MS); };
    const focus = () => { clearTimeout(t); setAway(false); };
    addEventListener("blur", blur);
    addEventListener("focus", focus);
    return () => { document.removeEventListener("visibilitychange", on); removeEventListener("blur", blur); removeEventListener("focus", focus); clearTimeout(t); };
  }, []);

  useEffect(() => {
    const Ctor = getSpeechRecognition();
    if (!enabled) setError("");
    if (!enabled || paused || held || !visible || away || !Ctor) { setState("off"); return; }
    let alive = true, failures = 0, armedUntil = 0, rec: SpeechRec | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined, disarm: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      armedUntil = Date.now() + ARMED_MS;
      setState("armed");
      clearTimeout(disarm);
      disarm = setTimeout(() => { if (alive) setState("listening"); }, ARMED_MS);
    };
    const ask = (text: string) => {
      armedUntil = 0; clearTimeout(disarm); setState("listening");
      dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));
    };
    const run = () => {
      if (!alive) return;
      const r = new Ctor();
      rec = r;
      r.lang = speechLang();
      r.continuous = true;
      r.interimResults = true; // interim lets us barge in on a spoken answer as soon as "Hey Orbit" is heard
      let interrupted = false;
      r.onresult = (e) => {
        failures = 0;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i], text = res[0].transcript, wake = extractWakeQuestion(text);
          if (!res.isFinal) {
            // Only the wake phrase interrupts: plain speech (or the answer's own echo) must not cut it off.
            if (wake && !interrupted) { interrupted = true; dispatchEvent(new Event(VOICE_INTERRUPT)); arm(); }
            continue;
          }
          interrupted = false;
          if (wake) { if (isSleepCommand(text)) ask(text); else if (wake.question) ask(wake.question); else arm(); } // "Orbit, shut down" keeps its name
          else if (armedUntil > Date.now()) { const q = normalizeTranscript(text); if (q) ask(q); }
        }
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
          alive = false; setState("off"); setError(speechErrorMessage(e.error) ?? "");
        } else if (e.error !== "no-speech" && e.error !== "aborted") failures++;
      };
      // Chrome ends continuous recognition every ~60 s (and after no-speech): restart, backing off on errors.
      r.onend = () => { if (alive) timer = setTimeout(run, failures ? Math.min(30000, 1000 * 2 ** failures) : 250); };
      try { r.start(); setState(armedUntil > Date.now() ? "armed" : "listening"); }
      catch { failures++; timer = setTimeout(run, Math.min(30000, 1000 * 2 ** failures)); }
    };
    // Must abort synchronously: push-to-talk calls rec.start() right after dispatching this.
    const pause = () => { alive = false; clearTimeout(timer); clearTimeout(disarm); rec?.abort(); setHeld(true); };
    addEventListener(VOICE_PAUSE, pause);
    setError("");
    run();
    return () => { removeEventListener(VOICE_PAUSE, pause); alive = false; clearTimeout(timer); clearTimeout(disarm); rec?.abort(); setState("off"); };
  }, [enabled, paused, held, visible, away]);

  useEffect(() => {
    const resume = () => setHeld(false);
    addEventListener(VOICE_RESUME, resume);
    return () => removeEventListener(VOICE_RESUME, resume);
  }, []);

  return { state, error };
}
