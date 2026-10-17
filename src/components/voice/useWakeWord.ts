"use client";
import { useEffect, useRef, useState } from "react";
import { loadVoiceSettings, recognizerFor, voiceContext, whisperLang, CORE_DONE, VOICE_ASK, VOICE_CONVERSATION, VOICE_INTERRUPT, type HandsFree } from "./bus";
import { alternatives, getSpeechRecognition, speechErrorMessage, VOICE_LISTEN, VOICE_PAUSE, VOICE_RESUME, type SpeechRec } from "./useVoiceInput";
import { extractWakeQuestion, isSleepCommand } from "./wake";
import { correctTranscript, endpointDelay, finalJoiner, isEcho, mergeFinals, pickBestAlternative, shouldBargeIn, STOP_WORDS, turnWaitMs } from "./hear";
import { startOrbitMic } from "./orbitmic";
import { isSpeaking, onSpeakingChange, speakChunk, speakingOrJustEnded, speechSettings, spokenText } from "./speak";
import { convStep, IDLE, isAddressedToOrbit, isConversationEnd, startsConversation, type ConvEvent, type ConvPhase } from "./conversation";
import { enrollment, loadVoicePrint, matchScore, matchThreshold, startVoiceSampler } from "./voiceprint";
import { recordUtterance, transcribeAudio } from "./whisper";

const AWAY_MS = 60_000; // window unfocused this long → stop listening
const ARMED_MS = 12_000; // after a bare "Hey Orbit", how long the next utterance counts as the question (kept open while you talk)
const ECHO_TAIL_MS = 1500; // after ORBIT stops talking, results that echo its words are still its own voice arriving late
const START_GUARD_MS = 400; // right after ORBIT stops, nothing starts a new utterance (the tail of its own audio)
const REPLY_MS = 6000; // ORBIT asked a question this recently: in open mic a short reply ("yes", "the second one") counts

const LOCAL = { maxSec: 8, minSpeechSec: 0.4 }; // waiting for "Orbit": short clips only, and never noise
const LOCAL_ARMED = { maxSec: 15, minSpeechSec: 0.4 }; // the question after "Orbit, wake up" may be longer
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

/** Hands-free "Hey Orbit" while on, not paused, the tab visible and the window focused within the last minute (or a
 *  conversation is on: open mic keeps listening while another window has focus).
 *  mode "chrome": continuous Chrome recognition. mode "local": a VAD loop records utterances and local Whisper looks for
 *  the wake word — no Chrome recognizer is ever created. */
export function useWakeWord(mode: HandsFree, paused: boolean, lang: string) {
  const [state, setState] = useState<"off" | "listening" | "armed">("off");
  const [interim, setInterim] = useState(""); // what it's hearing after "Orbit", shown live
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(true);
  const [away, setAway] = useState(false);
  const [held, setHeld] = useState(false); // push-to-talk has the mic
  // Conversation mode: survives the listening effect restarting (push-to-talk, focus), so it lives in a ref.
  const conv = useRef(IDLE);
  const [conversation, setConversation] = useState<ConvPhase>("idle");
  const convApply = (e: ConvEvent) => { conv.current = convStep(conv.current, e, Date.now()); setConversation(conv.current.phase); };
  const [note, setNote] = useState(""); // why open mic skipped an utterance, shown briefly
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashNote = (t: string) => { setNote(t); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(""), 4000); };
  // "Remember my voice": a parallel mic tap during conversation mode only, and only when the match is on.
  const sampler = useRef<ReturnType<typeof startVoiceSampler> | null>(null);
  const uttStart = useRef(0);
  const [printOn, setPrintOn] = useState(false);
  useEffect(() => {
    const on = () => setPrintOn(loadVoicePrint().sensitivity > 0);
    on();
    addEventListener("orbit:voiceprint", on);
    return () => removeEventListener("orbit:voiceprint", on);
  }, []);
  const talking = conversation !== "idle";
  const awayOff = away && !talking; // open mic was asked for: keep listening while you use another window
  const warned = useRef(false);
  useEffect(() => { // never holds the mic while hidden, during push-to-talk (held) or enrollment (which also sends VOICE_PAUSE)
    if (!talking || !printOn || mode === "off" || !visible || held || paused || enrollment.on) return;
    const s = startVoiceSampler(isSpeaking);
    sampler.current = s; warned.current = false;
    return () => { s.stop(); sampler.current = null; };
  }, [talking, printOn, mode, visible, held, paused]);
  useEffect(() => { if (mode === "off" && conv.current.phase !== "idle") convApply({ type: "stop" }); }, [mode]); // hands-free off ends open mic
  /** Open mic with voice match on: does the utterance that just ended sound like the enrolled user? No data = can't tell = yes. */
  const soundsLikeMe = () => {
    const p = loadVoicePrint(), s = sampler.current;
    if (!p.profile || !p.sensitivity) return true;
    if (!s?.ok) { if (!warned.current) { warned.current = true; flashNote("Voice match unavailable (no mic audio) — answering everyone"); } return true; }
    const f = s.features(uttStart.current);
    if (!f) return true;
    const score = matchScore(p.profile, f), ok = score >= matchThreshold(p.sensitivity);
    if (!ok) flashNote(`Skipped: didn't sound like you (match ${score.toFixed(2)})`);
    return ok;
  };

  useEffect(() => {
    const toggle = (e: Event) => {
      const on = (e as CustomEvent<{ on?: boolean }>).detail?.on ?? conv.current.phase === "idle";
      if (!on) return convApply({ type: "stop" });
      convApply({ type: "start", persist: loadVoiceSettings().conversation !== "once" });
      if (speechSettings().speak) speakChunk("I'm listening.");
    };
    addEventListener(VOICE_CONVERSATION, toggle);
    const offSpeaking = onSpeakingChange((on) => convApply({ type: on ? "speaking" : "spoke" }));
    const done = () => convApply({ type: "done" });
    addEventListener(CORE_DONE, done);
    return () => { removeEventListener(VOICE_CONVERSATION, toggle); removeEventListener(CORE_DONE, done); offSpeaking(); };
  }, []);
  useEffect(() => { // silence / stuck-thinking timeouts
    if (conversation === "idle") return;
    const t = setInterval(() => convApply({ type: "tick" }), 1000);
    return () => clearInterval(t);
  }, [conversation === "idle"]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const engine = recognizerFor({ handsFree: mode, engine: "chrome" }, "handsFree");
    const Ctor = engine === "chrome" ? getSpeechRecognition() : null; // local mode doesn't even look the recognizer up
    if (!engine) setError("");
    if (!engine || paused || held || !visible || awayOff || (engine === "chrome" && !Ctor)) { setState("off"); return; }
    let alive = true, failures = 0, armedUntil = 0, rec: SpeechRec | null = null;
    // The next utterance needs no wake word: after a bare "Orbit", or while a conversation waits for the user.
    const open = () => armedUntil > Date.now() || conv.current.phase === "listening";
    let timer: ReturnType<typeof setTimeout> | undefined, disarm: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      armedUntil = Date.now() + ARMED_MS;
      setState("armed");
      clearTimeout(disarm);
      disarm = setTimeout(() => { if (alive) setState("listening"); }, ARMED_MS);
    };
    const ask = (text: string) => {
      armedUntil = 0; clearTimeout(disarm); setState("listening"); setInterim("");
      convApply({ type: "ask" }); // every voice ask ends with orbit:core-done (CorePanel, or Orbit for navigation/follows)
      dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));
    };
    // A finished utterance (finals joined over the grace window) that started with the wake word or came while armed.
    const route = (text: string) => {
      if (!alive) return;
      setInterim("");
      const wake = extractWakeQuestion(text);
      const q = wake ? wake.question : text;
      const byWake = !!wake || armedUntil > Date.now(); // said "Orbit" (now or just before): always answer
      if (conv.current.phase !== "idle" && isConversationEnd(q)) { armedUntil = 0; clearTimeout(disarm); setState("listening"); convApply({ type: "stop" }); return; } // before sleep: "goodbye" ends the talk, not ORBIT
      if (startsConversation(text, byWake)) { armedUntil = 0; clearTimeout(disarm); setState("listening"); if (conv.current.phase === "idle") dispatchEvent(new CustomEvent(VOICE_CONVERSATION, { detail: { on: true } })); return; }
      if (!byWake && conv.current.phase === "idle" && !isSleepCommand(text)) return; // e.g. a bare start phrase that ran on into room talk
      if (!byWake && conv.current.phase !== "idle") { // open mic: only what looks meant for ORBIT, in the user's voice
        const orbitAsked = /\?\s*$/.test(spokenText()) && speakingOrJustEnded(REPLY_MS);
        if (!isAddressedToOrbit(text, voiceContext, orbitAsked)) { flashNote(`Not for me: “${text}”`); return; }
        if (!soundsLikeMe()) return;
      }
      if (isSleepCommand(text)) ask(text); // "Orbit, shut down" keeps its name
      else if (!wake) ask(text); // the question after a bare "Orbit"
      else if (wake.question && !/^(wake|woke)( up)?\W*$/i.test(wake.question)) ask(wake.question);
      else if (!wake.question && recognizerFor(loadVoiceSettings(), "pushToTalk") === "whisper") { armedUntil = 0; clearTimeout(disarm); setState("listening"); dispatchEvent(new Event(VOICE_LISTEN)); } // bare "Orbit": Whisper records the question
      else arm(); // "Orbit, wake up" while open just listens
    };
    const joiner = finalJoiner(endpointDelay, route); // waits 1.5–2.5 s of silence (longer after "and", "the", "um"…)
    let ctrl = new AbortController(); // local mode: aborts the current recording/transcription
    const asrLang = whisperLang(lang);
    // A Whisper transcript (local / ORBIT mic): act on it if it has the wake word, came while open, or starts/ends open mic.
    const heard = (text: string) => { if (text && (extractWakeQuestion(text) || open() || startsConversation(text, false) || (conv.current.phase !== "idle" && isConversationEnd(text)))) route(text); };
    const runLocal = async () => {
      setState("listening");
      while (alive) {
        if (isSpeaking()) { await sleep(300, ctrl.signal); if (!isSpeaking()) await sleep(500, ctrl.signal); continue; } // ORBIT's voice would come back through the mic
        const signal = ctrl.signal, armed = open();
        uttStart.current = Date.now();
        try {
          const audio = await recordUtterance(signal, () => {}, armed ? LOCAL_ARMED : LOCAL);
          if (!audio || !alive || signal.aborted) continue;
          if (armed) setInterim("Transcribing…");
          const text = correctTranscript(await transcribeAudio(audio, signal, asrLang));
          setInterim("");
          failures = 0; setError("");
          heard(text);
        } catch (e) {
          setInterim("");
          if (!alive) return;
          if (signal.aborted) { if (alive && ctrl.signal === signal) ctrl = new AbortController(); continue; }
          if (e instanceof DOMException && e.name === "NotAllowedError") { alive = false; setState("off"); setError(speechErrorMessage("not-allowed") ?? ""); return; }
          failures++;
          const status = (e as { status?: number }).status;
          // 503 = Whisper model not ready/failed to load: wait longer between tries instead of hammering the server.
          setError(e instanceof Error ? e.message : "Local listening failed.");
          await sleep(Math.min(300_000, (status === 503 ? 15_000 : 2_000) * 2 ** (failures - 1)), ctrl.signal);
        }
      }
    };
    // ORBIT mic: one open mic for the session. Segments end after 600 ms of quiet; transcripts are joined and answered
    // after turnWaitMs (sooner after a complete sentence). Speech over ORBIT for 300 ms stops it (VAD barge-in).
    let mic: { stop(): void } | null = null, turn: ReturnType<typeof setTimeout> | undefined;
    const runOrbit = async () => {
      let parts: string[] = [], inflight = 0, talkingNow = false, quietAt = 0, chain = Promise.resolve();
      const flush = () => { const text = mergeFinals(parts); parts = []; setInterim(""); if (alive) heard(text); };
      const schedule = () => { clearTimeout(turn); if (!inflight && !talkingNow && parts.length) turn = setTimeout(flush, turnWaitMs(mergeFinals(parts), Date.now() - quietAt)); };
      try {
        const m = await startOrbitMic({
          speaking: isSpeaking,
          bargeOk: () => loadVoiceSettings().bargeByVoice,
          onSuspended: (s) => setError(s ? "Click or press a key anywhere to enable ORBIT mic." : ""),
          onStart: () => { talkingNow = true; clearTimeout(turn); uttStart.current = Date.now() - 300; if (open()) convApply({ type: "hearing" }); },
          onBarge: () => dispatchEvent(new Event(VOICE_INTERRUPT)),
          onSegment: (audio, { overOrbit, barged }) => {
            talkingNow = false; quietAt = Date.now();
            // Too short to send, or Whisper is behind (keep up to 3 while a conversation waits, else 2): drop it.
            if (!audio || inflight >= (open() ? 3 : 2)) { schedule(); return; }
            inflight++;
            if (open() || parts.length) setInterim("Transcribing…");
            const signal = ctrl.signal;
            chain = chain.then(async () => {
              try {
                const text = correctTranscript(await transcribeAudio(audio, signal, asrLang));
                failures = 0; setError("");
                // Said over ORBIT: without voice barge-in only "stop" / "Orbit, …" count (and interrupt now); the rest is
                // most likely ORBIT's own voice. Either way never ORBIT's echo.
                const b = overOrbit && !barged && text ? shouldBargeIn(text, spokenText()) : null;
                if (b && isSpeaking()) dispatchEvent(new Event(VOICE_INTERRUPT));
                if (text && b !== "stop" && (!overOrbit || b || (barged && !isEcho(text, spokenText())))) parts.push(text);
              } catch (e) {
                if (!signal.aborted && (e as { status?: number }).status !== 429) setError(e instanceof Error ? e.message : "Transcription failed."); // 429: server skipped a backlog
              } finally {
                inflight--;
                if (alive) { if (!parts.length && !inflight) setInterim(""); schedule(); }
              }
            });
          },
        });
        if (!alive) return m.stop();
        mic = m;
        setState("listening");
      } catch (e) {
        if (!alive) return;
        setState("off");
        setError(e instanceof DOMException && e.name === "NotAllowedError" ? speechErrorMessage("not-allowed") ?? "" : "Couldn't open the microphone for ORBIT mic.");
      }
    };
    // Local mode: ORBIT started talking: drop the recording in progress (it would only hold ORBIT's own voice).
    const offSpeaking = engine === "whisper" && mode === "local" ? onSpeakingChange((on) => { if (on) { ctrl.abort(); ctrl = new AbortController(); } }) : () => {};
    const run = () => {
      if (!alive || !Ctor) return;
      const r = new Ctor();
      rec = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true; // interim lets us barge in on a spoken answer as soon as "Hey Orbit" is heard
      r.maxAlternatives = 5; // pickBestAlternative chooses (commands and the wake word win)
      let interrupted = false, lastInterim = "", heardAny = false;
      r.onresult = (e) => {
        failures = 0; heardAny = true;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const text = res.isFinal ? pickBestAlternative(alternatives(res), voiceContext) : correctTranscript(res[0].transcript);
          if (!text) continue;
          const armed = armedUntil > Date.now();
          // While ORBIT talks only "stop…" or "Orbit, …" may cut it off; its own voice through the speakers never counts.
          // Conversation mode too: open-mic barge-in on any speech made ORBIT interrupt itself on its own (misheard) echo.
          const wq = extractWakeQuestion(text);
          // "that's all" / "bye" ends open mic even while ORBIT talks or thinks (not when it's ORBIT's own echo).
          const ending = conv.current.phase !== "idle" && isConversationEnd(wq ? wq.question : text) && !isEcho(text, spokenText());
          const barge = isSpeaking() ? shouldBargeIn(text, spokenText()) ?? (ending ? "stop" : null) : null;
          if (!barge && !interrupted && speakingOrJustEnded(ECHO_TAIL_MS) && isEcho(text, spokenText())) continue;
          if (!barge && !interrupted && !joiner.pending && !armed && speakingOrJustEnded(START_GUARD_MS)) continue;
          const wake = wq;
          if (barge && !interrupted) { interrupted = true; dispatchEvent(new Event(VOICE_INTERRUPT)); } // interim: cut off at once
          const free = open() || interrupted; // barged in: take these words even though the cut-off answer still streams
          if (!joiner.pending && !lastInterim) uttStart.current = Date.now() - 1500; // a new utterance: its audio began before the first result
          if (!res.isFinal) {
            if (barge !== "stop" && (wake || armed)) arm(); // still talking: keep the window open
            if (free) convApply({ type: "hearing" });
            lastInterim = text;
            joiner.hold(text); // any interim = still talking: restart the silence timer
            if (wake || free || joiner.pending) setInterim(text);
            continue;
          }
          lastInterim = "";
          if (ending) { interrupted = false; joiner.cancel(); setInterim(""); dispatchEvent(new Event(VOICE_INTERRUPT)); convApply({ type: "stop" }); continue; }
          if (STOP_WORDS.test(text) && (barge || interrupted)) { interrupted = false; armedUntil = 0; clearTimeout(disarm); joiner.cancel(); setInterim(""); setState("listening"); continue; } // "stop" just silences ORBIT; it isn't a question
          interrupted = false;
          if (wake || free || joiner.pending || startsConversation(text, false)) { joiner.add(text); setInterim(text); } // "let's just talk" needs no "Orbit"
        }
      };
      r.onerror = (e) => {
        // audio-capture (mic unplugged / Bluetooth reconnecting) is temporary: retry with backoff instead of stopping for good.
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          alive = false; setState("off"); setError(speechErrorMessage(e.error) ?? "");
        } else if (e.error !== "no-speech" && e.error !== "aborted") failures++;
      };
      // Chrome ends continuous recognition every ~60 s (and after no-speech): restart, backing off on errors.
      // Mid-question, restart at once: words spoken in the gap would be lost. Words still only interim when Chrome ended
      // are kept (the joiner holds them as its tail; a question with no final yet gets them added).
      r.onend = () => {
        if (!alive) return;
        if (lastInterim && (joiner.pending || open())) joiner.add(lastInterim);
        // 0 ms only after a session that heard something: a session that "aborted" at once would spin otherwise.
        timer = setTimeout(run, failures ? Math.min(30000, 1000 * 2 ** failures) : heardAny && (joiner.pending || open()) ? 0 : 250);
      };
      try { r.start(); setState(armedUntil > Date.now() ? "armed" : "listening"); }
      catch { failures++; timer = setTimeout(run, Math.min(30000, 1000 * 2 ** failures)); }
    };
    // Must abort synchronously: push-to-talk calls rec.start() right after dispatching this.
    const pause = () => { alive = false; clearTimeout(timer); clearTimeout(turn); clearTimeout(disarm); joiner.cancel(); setInterim(""); rec?.abort(); mic?.stop(); ctrl.abort(); setHeld(true); };
    addEventListener(VOICE_PAUSE, pause);
    setError("");
    if (engine === "chrome") run(); else if (mode === "orbit") void runOrbit(); else void runLocal();
    return () => { removeEventListener(VOICE_PAUSE, pause); offSpeaking(); alive = false; clearTimeout(timer); clearTimeout(turn); clearTimeout(disarm); joiner.cancel(); setInterim(""); rec?.abort(); mic?.stop(); ctrl.abort(); setState("off"); };
  }, [mode, paused, held, visible, awayOff, lang]);

  useEffect(() => {
    const resume = () => setHeld(false);
    addEventListener(VOICE_RESUME, resume);
    return () => removeEventListener(VOICE_RESUME, resume);
  }, []);

  return { state, error, interim, conversation, note };
}
