"use client";
import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_VOICE, loadVoiceSettings, recognizerFor, saveVoiceSettings, voiceLevel, VOICE_ASK, type HandsFree, type VoiceSettings } from "./bus";
import { getSpeechRecognition, type VoiceInput } from "./useVoiceInput";
import { useWakeWord } from "./useWakeWord";

function sortVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const mine = (navigator.language || "en").slice(0, 2).toLowerCase();
  const pick = all.filter((v) => /^en/i.test(v.lang) || v.lang.toLowerCase().startsWith(mine));
  const score = (v: SpeechSynthesisVoice) => (/^en/i.test(v.lang) ? 2 : 0) + (/natural|neural|online|google/i.test(v.name) ? 1 : 0);
  return (pick.length ? pick : all).slice().sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** Mic button, voice settings popover and the "Hey Orbit" indicator for the command bar. */
export function VoiceControls({ voice }: { voice: VoiceInput }) {
  const [s, setS] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [ready, setReady] = useState(false); // stored settings loaded; until then hands-free stays off (never start Chrome by default)
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const micRef = useRef<HTMLButtonElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const wake = useWakeWord(ready ? s.handsFree : "off", voice.listening, s.lang);
  const pttEngine = recognizerFor(s, "pushToTalk");
  // Where the microphone audio goes right now: push-to-talk while it records, otherwise hands-free.
  const route = voice.listening ? pttEngine : recognizerFor(s, "handsFree");
  const [heard, setHeard] = useState(""); // the final text, shown briefly so you see what ORBIT understood

  useEffect(() => {
    setS(loadVoiceSettings());
    setReady(true);
    const on = (e: Event) => setS((e as CustomEvent<VoiceSettings>).detail ?? loadVoiceSettings());
    addEventListener("orbit:voice-settings", on);
    return () => removeEventListener("orbit:voice-settings", on);
  }, []);
  const update = (patch: Partial<VoiceSettings>) => saveVoiceSettings({ ...s, ...patch }); // the event updates `s`

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (!text) return;
      setHeard(text);
      clearTimeout(t);
      t = setTimeout(() => setHeard(""), 5000);
    };
    addEventListener(VOICE_ASK, on);
    return () => { removeEventListener(VOICE_ASK, on); clearTimeout(t); };
  }, []);

  // Local Whisper: load the model in the background so the first question doesn't wait for it.
  useEffect(() => { if (pttEngine === "whisper") void fetch("/api/voice/transcribe").catch(() => {}); }, [pttEngine]);

  // Voices load asynchronously in Chrome.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(sortVoices(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Pulse ring follows the mic level without re-rendering React.
  useEffect(() => {
    if (!voice.listening) return;
    let raf = 0;
    const tick = () => { micRef.current?.style.setProperty("--lvl", voiceLevel.mic.toFixed(3)); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); micRef.current?.style.setProperty("--lvl", "0"); };
  }, [voice.listening]);

  // Ctrl+M toggles the mic; Escape closes the popover or cancels listening before Orbit's Escape closes the panel.
  const { listening, toggle, cancel } = voice;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); toggle(); return; }
      if (e.key !== "Escape" || e.defaultPrevented) return; // preventDefault: one Esc does one thing (CorePanel checks it too)
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); gearRef.current?.focus(); }
      else if (listening) { e.preventDefault(); e.stopPropagation(); cancel(); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open, listening, toggle, cancel]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !gearRef.current?.contains(t)) setOpen(false);
    };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [open]);

  const chromeOk = typeof window === "undefined" || !!getSpeechRecognition();
  const routeText = route === "whisper" ? "🎙 Local (Whisper on this PC)" : route === "chrome" ? "🎙 Chrome (audio sent to Google while listening)" : "🎙 Hands-free off";
  const micLabel = !voice.supported ? "Voice input isn't supported in this browser" : listening ? "Stop listening (Esc cancels)" : "Ask by voice (Ctrl+M)";

  return (
    <>
      <button ref={micRef} type="button" className={"chip voice-mic" + (listening ? " on" : "")} onClick={toggle}
        aria-pressed={listening} aria-label={micLabel} title={`${micLabel}\n${routeText}`} aria-disabled={!voice.supported || undefined}>
        <span className="voice-ring" aria-hidden="true" />
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <button ref={gearRef} type="button" className="chip voice-gear" onClick={() => setOpen((o) => !o)}
        aria-label="Voice settings" title="Voice settings" aria-expanded={open} aria-controls={popId}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
        </svg>
      </button>
      {open && (
        <div ref={popRef} id={popId} className="glass voice-pop" role="dialog" aria-label="Voice settings">
          <label className="voice-col">Hands-free (say &ldquo;Orbit&hellip;&rdquo;)
            <select className="field" value={s.handsFree} onChange={(e) => update({ handsFree: e.target.value as HandsFree })}>
              <option value="off">Off</option>
              <option value="chrome" disabled={!chromeOk}>Chrome recognition (audio goes to Google while listening)</option>
              <option value="local">Local only (Whisper on this PC)</option>
            </select>
            <span className="muted text-[10px]">{s.handsFree === "chrome" ? "Chrome streams your microphone audio to Google’s speech service whenever this tab is visible and the window was used in the last minute."
              : s.handsFree === "local" ? "Audio never leaves this PC. Say “Orbit, …” in one go; ORBIT stops listening while it talks (click the mic to interrupt). English only; the first use downloads the model."
              : "ORBIT only listens when you click the mic (Ctrl+M)."}</span>
          </label>
          <label className="voice-col">Question transcription
            <select className="field" value={pttEngine ?? s.engine} disabled={s.handsFree === "local"} onChange={(e) => update({ engine: e.target.value === "whisper" ? "whisper" : "chrome" })}>
              <option value="chrome" disabled={!chromeOk}>Chrome (fast; audio goes to Google)</option>
              <option value="whisper">Local Whisper (on this PC)</option>
            </select>
            {s.handsFree === "local" && <span className="muted text-[10px]">Local only hands-free keeps the mic button on Whisper too.</span>}
          </label>
          <p className="muted text-[10px] voice-note">Local means the audio stays on this PC. Your words (text) still go to Claude to answer; memories are stored in your Supabase.</p>
          <label className="voice-col">Language (Chrome)
            <select className="field" value={s.lang} onChange={(e) => update({ lang: e.target.value })}>
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-IE">English (Ireland)</option>
              <option value="et-EE">Eesti</option>
            </select>
          </label>
          <span className="voice-sub">Spoken answers</span>
          <label className="voice-row"><input type="checkbox" checked={s.speak} onChange={(e) => update({ speak: e.target.checked })} /> Speak answers</label>
          <label className="voice-col">Voice
            <select className="field" value={s.voiceURI ?? ""} onChange={(e) => update({ voiceURI: e.target.value || null })}>
              <option value="">Default</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
          <label className="voice-col">Speed <span className="num">{s.rate.toFixed(2)}×</span>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
          </label>
        </div>
      )}
      {(wake.interim || heard || wake.error) && (
        <span className="voice-heard" role="status" aria-live="polite">
          {wake.interim ? <i>{wake.interim}…</i> : heard ? <>Heard: <b>{heard}</b></> : <>Hands-free paused: {wake.error}</>}
        </span>
      )}
      {(wake.state !== "off" || wake.error) && (
        <span className={"voice-wake" + (wake.state === "armed" ? " armed" : "") + (wake.error ? " bad" : "")} role="status"
          title={wake.error || "Hands-free mode: ORBIT is listening for “Hey Orbit”. Turn it off in voice settings."}>
          <span className="voice-dot" aria-hidden="true" />
          {wake.error ? "Hey Orbit paused" : wake.state === "armed" ? "Listening…" : "Hey Orbit on"}
        </span>
      )}
    </>
  );
}
