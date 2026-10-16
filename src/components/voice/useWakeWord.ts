"use client";
import { useEffect, useRef, useState } from "react";
import { loadVoiceSettings, recognizerFor, voiceContext, CORE_DONE, VOICE_ASK, VOICE_CONVERSATION, VOICE_INTERRUPT, type HandsFree } from "./bus";
import { alternatives, getSpeechRecognition, speechErrorMessage, VOICE_LISTEN, VOICE_PAUSE, VOICE_RESUME, type SpeechRec } from "./useVoiceInput";
import { extractWakeQuestion, isSleepCommand } from "./wake";
import { correctTranscript, endpointDelay, finalJoiner, isEcho, pickBestAlternative, shouldBargeIn, STOP_WORDS } from "./hear";
import { isSpeaking, onSpeakingChange, speakChunk, speakingOrJustEnded, speechSettings, spokenText } from "./speak";
import { conversationBargeIn, convStep, IDLE, isConversationEnd, isConversationStart, type ConvEvent, type ConvPhase } from "./conversation";
import { recordUtterance, transcribeAudio } from "./whisper";

const AWAY_MS = 60_000; // window unfocused this long → stop listening
const ARMED_MS = 12_000; // after a bare "Hey Orbit", how long the next utterance counts as the question (kept open while you talk)
const ECHO_TAIL_MS = 1500; // after ORBIT stops talking, results that echo its words are still its own voice arriving late
const START_GUARD_MS = 400; // right after ORBIT stops, nothing starts a new utterance (the tail of its own audio)

const LOCAL = { maxSec: 8, minSpeechSec: 0.4 }; // waiting for "Orbit": short clips only, and never noise
const LOCAL_ARMED = { maxSec: 15, minSpeechSec: 0.4 }; // the question after "Orbit, wake up" may be longer
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

/** Hands-free "Hey Orbit" while on, not paused, the tab visible and the window focused within the last minute.
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
    if (!engine || paused || held || !visible || away || (engine === "chrome" && !Ctor)) { setState("off"); return; }
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
      if (conv.current.phase !== "idle" && isConversationEnd(q)) { armedUntil = 0; clearTimeout(disarm); setState("listening"); convApply({ type: "stop" }); return; } // before sleep: "goodbye" ends the talk, not ORBIT
      if (isConversationStart(q)) { armedUntil = 0; clearTimeout(disarm); setState("listening"); dispatchEvent(new CustomEvent(VOICE_CONVERSATION, { detail: { on: true } })); return; }
      if (isSleepCommand(text)) ask(text); // "Orbit, shut down" keeps its name
      else if (!wake) ask(text); // the question after a bare "Orbit"
      else if (wake.question && !/^(wake|woke)( up)?\W*$/i.test(wake.question)) ask(wake.question);
      else if (!wake.question && recognizerFor(loadVoiceSettings(), "pushToTalk") === "whisper") { armedUntil = 0; clearTimeout(disarm); setState("listening"); dispatchEvent(new Event(VOICE_LISTEN)); } // bare "Orbit": Whisper records the question
      else arm(); // "Orbit, wake up" while open just listens
    };
    const joiner = finalJoiner(endpointDelay, route); // waits 1.5–2.5 s of silence (longer after "and", "the", "um"…)
    let ctrl = new AbortController(); // local mode: aborts the current recording/transcription
    const runLocal = async () => {
      setState("listening");
      while (alive) {
        if (isSpeaking()) { await sleep(300, ctrl.signal); if (!isSpeaking()) await sleep(500, ctrl.signal); continue; } // ORBIT's voice would come back through the mic
        const signal = ctrl.signal, armed = open();
        try {
          const audio = await recordUtterance(signal, () => {}, armed ? LOCAL_ARMED : LOCAL);
          if (!audio || !alive || signal.aborted) continue;
          if (armed) setInterim("Transcribing…");
          const text = correctTranscript(await transcribeAudio(audio, signal));
          setInterim("");
          failures = 0; setError("");
          if (text && (extractWakeQuestion(text) || open())) route(text);
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
    // ORBIT started talking: drop the recording in progress (it would only hold ORBIT's own voice).
    const offSpeaking = engine === "whisper" ? onSpeakingChange((on) => { if (on) { ctrl.abort(); ctrl = new AbortController(); } }) : () => {};
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
          // In a conversation any real speech (≥2 words ORBIT didn't just say) also cuts it off.
          const barge = isSpeaking() ? shouldBargeIn(text, spokenText()) ?? (conv.current.phase !== "idle" && conversationBargeIn(text, spokenText()) ? "talk" : null) : null;
          if (!barge && !interrupted && speakingOrJustEnded(ECHO_TAIL_MS) && isEcho(text, spokenText())) continue;
          if (!barge && !interrupted && !joiner.pending && !armed && speakingOrJustEnded(START_GUARD_MS)) continue;
          const wake = extractWakeQuestion(text);
          if (barge && !interrupted) { interrupted = true; dispatchEvent(new Event(VOICE_INTERRUPT)); } // interim: cut off at once
          const free = open() || interrupted; // barged in: take these words even though the cut-off answer still streams
          if (!res.isFinal) {
            if (barge !== "stop" && (wake || armed)) arm(); // still talking: keep the window open
            if (free) convApply({ type: "hearing" });
            lastInterim = text;
            joiner.hold(text); // any interim = still talking: restart the silence timer
            if (wake || free || joiner.pending) setInterim(text);
            continue;
          }
          lastInterim = "";
          if (STOP_WORDS.test(text) && (barge || interrupted)) { interrupted = false; armedUntil = 0; clearTimeout(disarm); joiner.cancel(); setInterim(""); setState("listening"); continue; } // "stop" just silences ORBIT; it isn't a question
          interrupted = false;
          if (wake || free || joiner.pending) { joiner.add(text); setInterim(text); }
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
    const pause = () => { alive = false; clearTimeout(timer); clearTimeout(disarm); joiner.cancel(); setInterim(""); rec?.abort(); ctrl.abort(); setHeld(true); };
    addEventListener(VOICE_PAUSE, pause);
    setError("");
    if (engine === "chrome") run(); else void runLocal();
    return () => { removeEventListener(VOICE_PAUSE, pause); offSpeaking(); alive = false; clearTimeout(timer); clearTimeout(disarm); joiner.cancel(); setInterim(""); rec?.abort(); ctrl.abort(); setState("off"); };
  }, [mode, paused, held, visible, away, lang]);

  useEffect(() => {
    const resume = () => setHeld(false);
    addEventListener(VOICE_RESUME, resume);
    return () => removeEventListener(VOICE_RESUME, resume);
  }, []);

  return { state, error, interim, conversation };
}
