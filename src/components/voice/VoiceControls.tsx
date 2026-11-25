"use client";
import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { DEFAULT_VOICE, loadVoiceSettings, recognizerFor, saveVoiceSettings, voiceLevel, whisperLang, VOICE_ASK, VOICE_CONVERSATION, VOICE_INTERRUPT, type HandsFree, type VoiceSettings } from "./bus";
import { useT } from "../i18n";
import { getSpeechRecognition, VOICE_PAUSE, VOICE_RESUME, type VoiceInput } from "./useVoiceInput";
import type { Wake } from "./WakeWord";
import { DeskVoiceToggle } from "./DeskVoice";
import { enrollment, loadVoicePrint, saveVoicePrint, startVoiceSampler, type VoicePrint, type VoiceProfile } from "./voiceprint";
import { warmNaturalVoice } from "./speak";
import { SpeakFirstToggle } from "../SpeakFirst";

// The wake-word listener (~40 KB with its helpers) loads only once hands-free is on.
const WakeWord = dynamic(() => import("./WakeWord"), { ssr: false });
const WAKE_OFF: Wake = { state: "off", error: "", interim: "", conversation: "idle", note: "" };
const ENROLL = ["The quick brown fox jumps over the lazy dog.", "Seven bright stars are shining over the quiet sea.", "I like warm soup and long walks on rainy days."];
const ENROLL_MS = 4500;

/** "Remember my voice": read three phrases, keep a rough profile on this device, set how strict open mic is about it. */
function VoiceMatch() {
  const { t } = useT();
  const [vp, setVp] = useState<VoicePrint>({ profile: null, sensitivity: 0 });
  const [step, setStep] = useState(-1); // index of the phrase being read
  const [msg, setMsg] = useState("");
  useEffect(() => setVp(loadVoicePrint()), []);
  const save = (v: VoicePrint) => { setVp(v); saveVoicePrint(v); };
  const enroll = async () => {
    if (enrollment.on) return;
    enrollment.on = true;
    setMsg(t("vcs.startingMic"));
    dispatchEvent(new Event(VOICE_PAUSE)); // hands-free (and its voice sampler) must not act on the phrases
    const s = startVoiceSampler();
    let heard = 0, profile: VoiceProfile | null = null;
    try {
      if (!(await s.ready)) return setMsg(t("vcs.noMic"));
      setMsg("");
      for (let i = 0; i < ENROLL.length; i++) {
        setStep(i);
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, ENROLL_MS));
        if (s.features(t0)) heard++; // enough speech in this phrase
      }
      profile = heard === ENROLL.length ? s.features() : null; // the sampler keeps 20 s: all three phrases
    } finally { s.stop(); setStep(-1); enrollment.on = false; dispatchEvent(new Event(VOICE_RESUME)); }
    if (!profile) return setMsg(t("vcs.notEnough"));
    save({ profile, sensitivity: vp.sensitivity || 0.5 });
    setMsg(t("vcs.saved"));
  };
  const pct = Math.round(vp.sensitivity * 100);
  return (
    <>
      <span className="voice-sub">{t("vcs.remember")}</span>
      <p className="muted text-[10px]">{t("vcs.matchHelp")}</p>
      {step >= 0 ? <p role="status" aria-live="polite">{t("vcs.readAloud", { n: step + 1 })} <b>{ENROLL[step]}</b></p>
        : <button type="button" className="chip" onClick={() => void enroll()}>{vp.profile ? t("vcs.rerecord") : t("vcs.record")}</button>}
      {msg && <span className="muted text-[10px]" role="status">{msg}</span>}
      <label className="voice-col">{t("vcs.match")} <span className="num">{pct ? t("vcs.strictness", { n: pct }) : t("vcs.off")}</span>
        <input type="range" min={0} max={100} step={5} value={pct} disabled={!vp.profile} onChange={(e) => save({ ...vp, sensitivity: Number(e.target.value) / 100 })} />
        {!vp.profile && <span className="muted text-[10px]">{t("vcs.offUntil")}</span>}
      </label>
      {vp.profile && <button type="button" className="chip" onClick={() => { save({ profile: null, sensitivity: 0 }); setMsg(t("vcs.forgotten")); }}>{t("vcs.forget")}</button>}
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
  const { t } = useT();
  const [s, setS] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [ready, setReady] = useState(false); // stored settings loaded; until then hands-free stays off (never start Chrome by default)
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const micRef = useRef<HTMLButtonElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const [w, setWake] = useState<Wake | null>(null);
  const wake = w ?? WAKE_OFF;
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

  // Ctrl+M toggles the mic, Ctrl+Shift+M conversation mode; Escape closes the popover, cancels listening or ends the
  // conversation before Orbit's Escape closes the panel.
  const { listening, toggle, cancel } = voice;
  const talking = wake.conversation !== "idle";
  const setTalking = (on: boolean) => dispatchEvent(new CustomEvent(VOICE_CONVERSATION, { detail: { on } }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (!e.shiftKey) toggle(); else if (talking || loadVoiceSettings().handsFree !== "off") setTalking(!talking);
        return;
      }
      if (e.key !== "Escape" || e.defaultPrevented) return; // preventDefault: one Esc does one thing (CorePanel checks it too)
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); gearRef.current?.focus(); }
      else if (listening) { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (talking) { e.preventDefault(); e.stopPropagation(); dispatchEvent(new Event(VOICE_INTERRUPT)); setTalking(false); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [open, listening, toggle, cancel, talking]);

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
  useEffect(() => { voiceLevel.conversation = talking; return () => { voiceLevel.conversation = false; }; }, [talking]); // ORBIT speaks first stays quiet
  const [talkNote, setTalkNote] = useState(""); // screen readers hear start and end
  useEffect(() => { setTalkNote((n) => talking ? "Conversation mode started" : n ? "Conversation mode ended" : ""); }, [talking]);
  const micLabel = t(!voice.supported ? "voice.micNone" : listening ? "voice.micStop" : "voice.micAsk");

  return (
    <>
      {ready && s.handsFree !== "off" && <WakeWord mode={s.handsFree} paused={voice.listening} lang={s.lang} onChange={setWake} />}
      <button ref={micRef} type="button" className={"chip voice-mic" + (listening ? " on" : live ? " live" : "")} onClick={toggle}
        aria-pressed={listening} aria-label={micLabel} title={`${micLabel}\n${routeText}`} aria-disabled={!voice.supported || undefined}>
        <span className="voice-ring" aria-hidden="true" />
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      {/* Conversation mode needs hands-free: with it off the button was a dead (disabled) control, so it only shows when it can work. */}
      {(s.handsFree !== "off" || talking) && <button type="button" className="chip voice-gear" onClick={() => setTalking(!talking)} aria-pressed={talking}
        aria-label={talking ? t("voice.convEnd") : t("voice.convStart")} title={talking ? t("voice.convEnd") : t("voice.convTitle")}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7l-3 2.5V11h.5a2 2 0 0 1-2-2z" /></svg>
      </button>}
      <button type="button" className="chip voice-gear" onClick={() => update({ speak: !s.speak })} aria-pressed={s.speak}
        aria-label={t(s.speak ? "voice.muteAria" : "voice.unmuteAria")} title={t(s.speak ? "voice.speakOnTitle" : "voice.speakOffTitle")}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />{s.speak ? <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" /> : <path d="M11 6l3 4M14 6l-3 4" />}
        </svg>
      </button>
      <button ref={gearRef} type="button" className="chip voice-gear" onClick={() => setOpen((o) => !o)}
        aria-label={t("voice.settings")} title={t("voice.settings")} aria-expanded={open} aria-controls={popId}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
        </svg>
      </button>
      {open && (
        <div ref={popRef} id={popId} className="glass voice-pop" role="dialog" aria-label={t("voice.settings")}>
          <label className="voice-col">{t("vcs.handsFree")}
            <select className="field" value={s.handsFree} onChange={(e) => update({ handsFree: e.target.value as HandsFree })}>
              <option value="off">{t("vcs.off")}</option>
              <option value="chrome" disabled={!chromeOk}>{t("vcs.hfChrome")}</option>
              <option value="orbit" disabled={!whisperOk && s.handsFree !== "orbit"}>{t("vcs.hfOrbit")}</option>
              <option value="local">{t("vcs.hfLocal")}</option>
            </select>
            {s.handsFree === "orbit" && <label className="voice-row"><input type="checkbox" checked={s.bargeByVoice} onChange={(e) => update({ bargeByVoice: e.target.checked })} /> {t("vcs.barge")}</label>}
            {!whisperOk && <span className="muted text-[10px]">{t("vcs.noWhisper")}</span>}
            <span className="muted text-[10px]">{s.handsFree === "chrome" ? t("vcs.hfChromeHelp") : s.handsFree === "orbit" ? t("vcs.hfOrbitHelp") : s.handsFree === "local" ? t("vcs.hfLocalHelp") : t("vcs.hfOffHelp")}</span>
          </label>
          <label className="voice-col">{t("vcs.transcription")}
            <select className="field" value={pttEngine ?? s.engine} disabled={s.handsFree === "local" || s.handsFree === "orbit"} onChange={(e) => update({ engine: e.target.value === "whisper" ? "whisper" : "chrome" })}>
              <option value="chrome" disabled={!chromeOk}>{t("vcs.trChrome")}</option>
              <option value="whisper">{t("vcs.trWhisper")}</option>
            </select>
            {(s.handsFree === "local" || s.handsFree === "orbit") && <span className="muted text-[10px]">{t("vcs.trLocalNote")}</span>}
          </label>
          <p className="muted text-[10px] voice-note">{t("vcs.localNote")}</p>
          <label className="voice-col">{t("vcs.lang")}
            <select className="field" value={s.lang} onChange={(e) => update({ lang: e.target.value })}>
              <option value="en-US">{t("vcs.enUS")}</option>
              <option value="en-GB">{t("vcs.enGB")}</option>
              <option value="en-IE">{t("vcs.enIE")}</option>
              <option value="et-EE">{"Eesti"}</option>
            </select>
          </label>
          <label className="voice-col">{t("vcs.conv")}
            <select className="field" value={s.conversation} onChange={(e) => update({ conversation: e.target.value === "once" ? "once" : "stay" })}>
              <option value="stay">{t("vcs.convStay")}</option>
              <option value="once">{t("vcs.convOnce")}</option>
            </select>
            <span className="muted text-[10px]">{t("voice.convHelp")}</span>
          </label>
          <VoiceMatch />
          <DeskVoiceToggle />
          <span className="voice-sub">{t("vcs.spoken")}</span>
          <label className="voice-row"><input type="checkbox" checked={s.speak} onChange={(e) => update({ speak: e.target.checked })} /> {t("vcs.speak")}</label>
          <SpeakFirstToggle />
          <label className="voice-col">{t("vcs.voice")}
            <select className="field" value={s.voiceURI ?? ""} onChange={(e) => { update({ voiceURI: e.target.value || null }); if (e.target.value.startsWith("kokoro:")) warmNaturalVoice(); }}>
              <option value="">{t("vcs.default")}</option>
              <optgroup label={t("vcs.natural")}>
                <option value="kokoro:af_heart">{t("vcs.heart")}</option>
                <option value="kokoro:af_bella">{`Bella (${t("vcs.us")})`}</option>
                <option value="kokoro:bf_emma">{`Emma (${t("vcs.uk")})`}</option>
                <option value="kokoro:bm_george">{`George (${t("vcs.uk")})`}</option>
                <option value="kokoro:am_michael">{`Michael (${t("vcs.us")})`}</option>
              </optgroup>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
          <label className="voice-col">{t("vcs.speed")} <span className="num">{s.rate.toFixed(2)}×</span>
            <input type="range" min={0.8} max={1.4} step={0.05} value={s.rate} onChange={(e) => update({ rate: Number(e.target.value) })} />
          </label>
        </div>
      )}
      {(wake.interim || heard || showErr || wake.note) && (
        <span className="voice-heard" role="status" aria-live="polite">
          {wake.interim ? <i>{wake.interim}…</i> : heard ? <>{t("voice.heard")} <b>{heard}</b></> : wake.note ? <i>{wake.note}</i> : <>{t("voice.pausedWhy", { why: wake.error ?? "" })}</>}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">{talkNote}</span>
      {talking ? (
        <button type="button" className="voice-wake armed" onClick={() => setTalking(false)} title={t("voice.convEnd")}>
          <span className="voice-dot" aria-hidden="true" />
          {t("voice.openMic", { phase: t(wake.conversation === "listening" ? "voice.phaseListening" : wake.conversation === "thinking" ? "voice.phaseThinking" : "voice.phaseSpeaking") })}
        </button>
      ) : (wake.state !== "off" || wake.error) && (
        // Paused (mic blocked): a click opens the voice settings to fix it; it used to switch hands-free OFF, the opposite of what he wanted.
        <button type="button" aria-live="polite" className={"voice-wake voice-status" + (wake.state === "armed" ? " armed" : "") + (wake.error ? " bad" : "")}
          onClick={() => (wake.error ? setOpen(true) : update({ handsFree: "off" }))}
          title={wake.error ? t("voice.wakePausedTitle", { why: wake.error }) : t("voice.wakeOnTitle")}>
          <span className="voice-dot" aria-hidden="true" />
          {t(wake.error ? "voice.wakePaused" : wake.state === "armed" ? "voice.wakeListening" : "voice.wakeOn")}
        </button>
      )}
    </>
  );
}
