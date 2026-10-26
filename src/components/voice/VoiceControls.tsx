"use client";
import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_VOICE, loadVoiceSettings, recognizerFor, saveVoiceSettings, voiceLevel, whisperLang, VOICE_ASK, VOICE_CONVERSATION, type HandsFree, type VoiceSettings } from "./bus";
import { getSpeechRecognition, VOICE_PAUSE, VOICE_RESUME, type VoiceInput } from "./useVoiceInput";
import { useWakeWord } from "./useWakeWord";
import { enrollment, loadVoicePrint, saveVoicePrint, startVoiceSampler, type VoicePrint, type VoiceProfile } from "./voiceprint";
import { warmNaturalVoice } from "./speak";

const ENROLL = ["The quick brown fox jumps over the lazy dog.", "Seven bright stars are shining over the quiet sea.", "I like warm soup and long walks on rainy days."];
const ENROLL_MS = 4500;

/** "Remember my voice": read three phrases, keep a rough profile on this device, set how strict open mic is about it. */
function VoiceMatch() {
  const [vp, setVp] = useState<VoicePrint>({ profile: null, sensitivity: 0 });
  const [step, setStep] = useState(-1); // index of the phrase being read
  const [msg, setMsg] = useState("");
  useEffect(() => setVp(loadVoicePrint()), []);
  const save = (v: VoicePrint) => { setVp(v); saveVoicePrint(v); };
  const enroll = async () => {
    if (enrollment.on) return;
    enrollment.on = true;
    setMsg("Starting the mic…");
    dispatchEvent(new Event(VOICE_PAUSE)); // hands-free (and its voice sampler) must not act on the phrases
    const s = startVoiceSampler();
    let heard = 0, profile: VoiceProfile | null = null;
    try {
      if (!(await s.ready)) return setMsg("Couldn’t open the microphone.");
      setMsg("");
      for (let i = 0; i < ENROLL.length; i++) {
        setStep(i);
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, ENROLL_MS));
        if (s.features(t0)) heard++; // enough speech in this phrase
      }
      profile = heard === ENROLL.length ? s.features() : null; // the sampler keeps 20 s: all three phrases
    } finally { s.stop(); setStep(-1); enrollment.on = false; dispatchEvent(new Event(VOICE_RESUME)); }
    if (!profile) return setMsg("Didn’t hear enough speech. Check the mic and try again, a bit closer.");
    save({ profile, sensitivity: vp.sensitivity || 0.5 });
    setMsg("Voice saved on this device.");
  };
  const pct = Math.round(vp.sensitivity * 100);
  return (
    <>
      <span className="voice-sub">Remember my voice (conversation mode)</span>
      <p className="muted text-[10px]">Rough voice match — helps ignore TV and other people, not a security lock. Audio stays in this browser; only a small profile is saved here.</p>
      {step >= 0 ? <p role="status" aria-live="polite">Read aloud ({step + 1}/3): <b>{ENROLL[step]}</b></p>
        : <button type="button" className="chip" onClick={() => void enroll()}>{vp.profile ? "Re-record my voice" : "Record my voice (3 phrases)"}</button>}
      {msg && <span className="muted text-[10px]" role="status">{msg}</span>}
      <label className="voice-col">Voice match <span className="num">{pct ? `strictness ${pct}%` : "Off"}</span>
        <input type="range" min={0} max={100} step={5} value={pct} disabled={!vp.profile} onChange={(e) => save({ ...vp, sensitivity: Number(e.target.value) / 100 })} />
        {!vp.profile && <span className="muted text-[10px]">Off until you record your voice.</span>}
      </label>
      {vp.profile && <button type="button" className="chip" onClick={() => { save({ profile: null, sensitivity: 0 }); setMsg("Voice forgotten."); }}>Forget my voice</button>}
    </>
  );
}

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
  const asking = voice.listening || wake.conversation === "listening";
  useEffect(() => { voiceLevel.listening = asking; return () => { voiceLevel.listening = false; }; }, [asking]); // the singularity leans in
  const pttEngine = recognizerFor(s, "pushToTalk");
  // Where the microphone audio goes right now: push-to-talk while it records, otherwise hands-free.
  const route = voice.listening ? pttEngine : recognizerFor(s, "handsFree");
  const [heard, setHeard] = useState(""); // the final text, shown briefly so you see what ORBIT understood
  const [errSeen, setErrSeen] = useState(""); // a hands-free error is shown for 8 s, then stays only in the status chip
  useEffect(() => { if (!wake.error) return; const t = setTimeout(() => setErrSeen(wake.error ?? ""), 8000); return () => clearTimeout(t); }, [wake.error]);
  const showErr = !!wake.error && wake.error !== errSeen;

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
  const [whisperOk, setWhisperOk] = useState(true); // false once the server said the model can't load
  const asrLang = whisperLang(s.lang);
  useEffect(() => { if (pttEngine === "whisper") void fetch(`/api/voice/transcribe?lang=${asrLang}`).then((r) => setWhisperOk(r.status !== 503)).catch(() => {}); }, [pttEngine, asrLang]);

  // Voices load asynchronously in Chrome.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(sortVoices(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Pulse ring follows the mic level without re-rendering React. ORBIT mic: always on while it listens, with a state
  // (data-mic: listening / hearing / thinking / speaking) for the ring's look.
  const live = s.handsFree === "orbit" && wake.state !== "off" && !voice.listening;
  const thinking = useRef(false);
  thinking.current = wake.conversation === "thinking";
  useEffect(() => {
    if (!voice.listening && !live) return;
    let raf = 0;
    const tick = () => {
      const el = micRef.current;
      el?.style.setProperty("--lvl", voiceLevel.mic.toFixed(3));
      if (el) el.dataset.mic = voiceLevel.speak > 0.01 ? "speaking" : voiceLevel.mic > 0.12 ? "hearing" : thinking.current ? "thinking" : "listening";
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); micRef.current?.style.setProperty("--lvl", "0"); if (micRef.current) delete micRef.current.dataset.mic; };
  }, [voice.listening, live]);

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
  const talking = wake.conversation !== "idle";
  const [talkNote, setTalkNote] = useState(""); // screen readers hear start and end
  useEffect(() => { setTalkNote((n) => talking ? "Conversation mode started" : n ? "Conversation mode ended" : ""); }, [talking]);
  const setTalking = (on: boolean) => dispatchEvent(new CustomEvent(VOICE_CONVERSATION, { detail: { on } }));
  const micLabel = !voice.supported ? "Voice input isn't supported in this browser" : listening ? "Stop listening (Esc cancels)" : "Ask by voice (Ctrl+M)";

  return (
    <>
      <button ref={micRef} type="button" className={"chip voice-mic" + (listening ? " on" : live ? " live" : "")} onClick={toggle}
        aria-pressed={listening} aria-label={micLabel} title={`${micLabel}\n${routeText}`} aria-disabled={!voice.supported || undefined}>
        <span className="voice-ring" aria-hidden="true" />
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <button type="button" className="chip voice-gear" onClick={() => setTalking(!talking)} aria-pressed={talking}
        disabled={s.handsFree === "off" && !talking} aria-label={talking ? "End conversation mode" : "Conversation mode: keep listening after each answer"}
        title={s.handsFree === "off" ? "Conversation mode needs hands-free on (voice settings)" : talking ? "End conversation mode" : "Conversation mode (or say “Orbit, let’s talk”)"}>
        <span aria-hidden="true">💬</span>
      </button>
      <button type="button" className="chip voice-gear" onClick={() => update({ speak: !s.speak })} aria-pressed={s.speak}
        aria-label={s.speak ? "Mute ORBIT's voice" : "Unmute ORBIT's voice"} title={s.speak ? "ORBIT speaks answers — click to mute" : "ORBIT is muted (starts muted each time) — click to hear answers"}>
        <span aria-hidden="true">{s.speak ? "🔊" : "🔇"}</span>
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
              <option value="orbit" disabled={!whisperOk && s.handsFree !== "orbit"}>ORBIT mic (best: local Whisper, echo-cancelled open mic)</option>
              <option value="local">Local only (Whisper on this PC)</option>
            </select>
            {s.handsFree === "orbit" && <label className="voice-row"><input type="checkbox" checked={s.bargeByVoice} onChange={(e) => update({ bargeByVoice: e.target.checked })} /> Interrupt by voice (headphones). Off: only &ldquo;stop&rdquo; or &ldquo;Orbit, &hellip;&rdquo; cuts ORBIT off, so it can&rsquo;t interrupt itself through the speakers.</label>}
            {!whisperOk && <span className="muted text-[10px]">Local Whisper didn’t load on the server (see its log), so ORBIT mic and Local only are unavailable.</span>}
            <span className="muted text-[10px]">{s.handsFree === "chrome" ? "Chrome streams your microphone audio to Google’s speech service whenever this tab is visible and the window was used in the last minute, or while conversation mode is on."
              : s.handsFree === "orbit" ? "Audio never leaves this PC. One open, echo-cancelled mic: talk over ORBIT to interrupt it, it answers sooner after a finished sentence. English, or Estonian with the language set to Eesti. The first use downloads the model; the first Estonian use downloads another ~1 GB model and voice pauses until it's done."
              : s.handsFree === "local" ? "Audio never leaves this PC. Say “Orbit, …” in one go; ORBIT stops listening while it talks (click the mic to interrupt). English, or Estonian with the language set to Eesti; the first use downloads the model (Estonian: another ~1 GB; voice pauses until it's done)."
              : "ORBIT only listens when you click the mic (Ctrl+M)."}</span>
          </label>
          <label className="voice-col">Question transcription
            <select className="field" value={pttEngine ?? s.engine} disabled={s.handsFree === "local" || s.handsFree === "orbit"} onChange={(e) => update({ engine: e.target.value === "whisper" ? "whisper" : "chrome" })}>
              <option value="chrome" disabled={!chromeOk}>Chrome (fast; audio goes to Google)</option>
              <option value="whisper">Local Whisper (on this PC)</option>
            </select>
            {(s.handsFree === "local" || s.handsFree === "orbit") && <span className="muted text-[10px]">Local hands-free keeps the mic button on Whisper too.</span>}
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
          <label className="voice-col">Conversation mode (&ldquo;Orbit, let&rsquo;s talk&rdquo;)
            <select className="field" value={s.conversation} onChange={(e) => update({ conversation: e.target.value === "once" ? "once" : "stay" })}>
              <option value="stay">Stays on until I say stop</option>
              <option value="once">One follow-up only</option>
            </select>
            <span className="muted text-[10px]">Say &ldquo;let&rsquo;s just talk&rdquo;. ORBIT then answers questions and requests without &ldquo;Orbit&rdquo; and ignores chatter; it pauses while it speaks. Ends on &ldquo;that&rsquo;s all&rdquo; / &ldquo;stop listening&rdquo;, 💬, or 5 min without a question (one-follow-up: 30 s of silence).</span>
          </label>
          <VoiceMatch />
          <span className="voice-sub">Spoken answers</span>
          <label className="voice-row"><input type="checkbox" checked={s.speak} onChange={(e) => update({ speak: e.target.checked })} /> Speak answers</label>
          <label className="voice-col">Voice
            <select className="field" value={s.voiceURI ?? ""} onChange={(e) => { update({ voiceURI: e.target.value || null }); if (e.target.value.startsWith("kokoro:")) warmNaturalVoice(); }}>
              <option value="">Default</option>
              <optgroup label="Natural (runs on this PC, ~90 MB first download)">
                <option value="kokoro:af_heart">Heart (US, warm)</option>
                <option value="kokoro:af_bella">Bella (US)</option>
                <option value="kokoro:bf_emma">Emma (UK)</option>
                <option value="kokoro:bm_george">George (UK)</option>
                <option value="kokoro:am_michael">Michael (US)</option>
              </optgroup>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
          <label className="voice-col">Speed <span className="num">{s.rate.toFixed(2)}×</span>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
          </label>
        </div>
      )}
      {(wake.interim || heard || showErr || wake.note) && (
        <span className="voice-heard" role="status" aria-live="polite">
          {wake.interim ? <i>{wake.interim}…</i> : heard ? <>Heard: <b>{heard}</b></> : wake.note ? <i>{wake.note}</i> : <>Hands-free paused: {wake.error}</>}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">{talkNote}</span>
      {talking ? (
        <button type="button" className="voice-wake armed" onClick={() => setTalking(false)} title="Click to end conversation mode">
          <span className="voice-dot" aria-hidden="true" />
          Open mic · {wake.conversation === "listening" ? "listening" : wake.conversation === "thinking" ? "thinking" : "speaking (mic paused)"} — ✕ stop
        </button>
      ) : (wake.state !== "off" || wake.error) && (
        <span className={"voice-wake" + (wake.state === "armed" ? " armed" : "") + (wake.error ? " bad" : "")} role="status"
          title={wake.error || "Hands-free mode: ORBIT is listening for “Hey Orbit”. Turn it off in voice settings."}>
          <span className="voice-dot" aria-hidden="true" />
          {wake.error ? "Hey Orbit paused" : wake.state === "armed" ? "Listening…" : "Hey Orbit on"}
        </span>
      )}
    </>
  );
}
