"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { concat, downsample, encodeWav, rms, zcr, MIC_START, type Mic } from "@/lib/audio-pure";
import { CALL_VAD, callVad, endSilenceMs, worthSending } from "@/lib/call-pure";
import { MIC } from "./voice/voiceprint";
import { CALL_ACTIVE } from "./voice/bus";

// "ORBIT wants to talk": the call screen (phone remote and PC). ORBIT speaks first; then push-to-talk or hands-free (VAD), with
// barge-in: talking over ORBIT stops its voice and the reply in flight. Audio goes only to this ORBIT server (/api/remote/talk),
// as one WAV per utterance; replies come back as NDJSON, one sentence of Kokoro audio at a time. compact: PC, only the ring.
type Line = { who: "orbit" | "you"; text: string };
type Phase = "idle" | "ringing" | "connecting" | "live";
const API = "/api/remote/talk";
/** Car mode's Talk button: start a call now (dispatched inside the tap, so iOS still allows the mic and audio). */
export const CAR_TALK = "orbit:car-talk";
/** The PC's per-turn timings (ms since his audio arrived), as the latency line names them. */
const STAGE: Record<string, string> = { asr: "heard", answer_text: "first words", core: "answer done", tts_first: "voice", first_audio: "first sound", answer_audio: "answer sound" };
const b64ToBuf = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
type Rec = { start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; lang: string; interimResults: boolean };
const SpeechRec = () => (typeof window === "undefined" ? undefined : ((window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition));

export function RemoteCall({ compact = false }: { compact?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [allowed, setAllowed] = useState(false);
  const [checkin, setCheckin] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"listening" | "thinking" | "talking">("listening");
  const [handsFree, setHandsFree] = useState(true);
  const [ptt, setPtt] = useState(false);
  const [lat, setLat] = useState("");
  const [err, setErr] = useState("");
  const [car, setCar] = useState(false); // started from car mode: big type, no transcript list, no voice approvals (server side)
  const [live, setLive] = useState(false); // a call is on somewhere (e.g. the phone): this PC's "Hey Orbit" stays off
  const r = useRef({ ctx: null as AudioContext | null, stream: null as MediaStream | null, proc: null as ScriptProcessorNode | null, call: "", playAt: 0,
    sources: [] as AudioBufferSourceNode[], turn: null as AbortController | null, handsFree: true, ptt: false, seg: [] as Float32Array[], pre: [] as Float32Array[],
    m: { ...MIC_START } as Mic, segSpeech: 0, endedAt: 0, firstPlay: 0, lagWhat: "replied", speech: false, recognizer: null as Rec | null });

  const say = (l: Line) => setLines((ls) => [...ls.slice(-5), l]);
  const talking = () => !!r.current.ctx && r.current.ctx.currentTime < r.current.playAt - 0.05;

  const poll = useCallback(async () => {
    const res = await fetch(compact ? API : `${API}?warm=1`).catch(() => null); // the phone's call card: make the opener ahead
    if (!res?.ok) return;
    setAllowed(true);
    const j = (await res.json()) as { ringing: string | null; live?: boolean; checkin: string };
    setCheckin(j.checkin); setLive(!!j.live);
    setPhase((p) => (p === "idle" && (j.ringing || location.hash === "#r-call") ? "ringing" : p));
  }, []);
  useEffect(() => {
    void poll();
    const t = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, compact ? 30_000 : 20_000);
    const hash = () => { if (location.hash === "#r-call") void poll(); };
    addEventListener("hashchange", hash);
    return () => { clearInterval(t); removeEventListener("hashchange", hash); };
  }, [poll, compact]);
  const inCall = live || phase === "connecting" || phase === "live";
  useEffect(() => { dispatchEvent(new CustomEvent(CALL_ACTIVE, { detail: { on: inCall } })); }, [inCall]);

  /** Stop ORBIT mid-sentence and drop the reply in flight. */
  const bargeIn = () => {
    const c = r.current;
    c.turn?.abort(); c.turn = null;
    c.sources.forEach((s) => { try { s.stop(); } catch { /* ended */ } });
    c.sources = []; c.playAt = 0;
  };

  async function play(b64: string) {
    const c = r.current, ctx = c.ctx!;
    const buf = await ctx.decodeAudioData(b64ToBuf(b64));
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.02, c.playAt);
    src.start(at);
    c.playAt = at + buf.duration;
    c.sources.push(src);
    src.onended = () => { c.sources = c.sources.filter((x) => x !== src); if (!talking()) setState("listening"); };
    if (!c.firstPlay) {
      c.firstPlay = performance.now() + (at - ctx.currentTime) * 1000;
      if (c.endedAt) setLat(`${c.lagWhat} ${((c.firstPlay - c.endedAt) / 1000).toFixed(1)} s after you ${c.lagWhat === "spoke" ? "answered" : "stopped"}`);
    }
    setState("talking");
  }

  /** ORBIT's NDJSON: {call} (pick-up), {heard}, {say} with audio, {error}, {end} (he said bye), {done} with the PC's timings. */
  async function readEvents(stream: NonNullable<Response["body"]>, signal: AbortSignal) {
    const c = r.current;
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const ls = buf.split("\n"); buf = ls.pop() ?? "";
      for (const l of ls) {
        if (!l.trim()) continue;
        const ev = JSON.parse(l) as { type: string; id?: string; text?: string; audio?: string | null; error?: string; ms?: Record<string, number>; path?: string };
        if (signal.aborted) return;
        if (ev.type === "call" && ev.id) { c.call = ev.id; setPhase("live"); }
        else if (ev.type === "heard" && ev.text) say({ who: "you", text: ev.text });
        else if (ev.type === "say" && ev.text) { say({ who: "orbit", text: ev.text }); if (ev.audio) await play(ev.audio); }
        else if (ev.type === "error") setErr(ev.error ?? "Something went wrong");
        else if (ev.type === "end") setTimeout(() => { if (c.call) hangUp(); }, Math.max(0, ((c.playAt - (c.ctx?.currentTime ?? 0)) * 1000)) + 400);
        else if (ev.type === "done" && ev.ms) setLat((x) => `${x}${x ? " · " : ""}PC${ev.path ? ` (${ev.path})` : ""}: ${Object.entries(ev.ms!).map(([k, v]) => `${STAGE[k] ?? k} ${v} ms`).join(", ")}`);
      }
    }
  }

  /** One turn: his audio (or text from on-device recognition) in, ORBIT's sentences out as they're ready. */
  async function turn(body: { audio: Float32Array } | { text: string }) {
    const c = r.current;
    bargeIn();
    const ac = (c.turn = new AbortController());
    c.firstPlay = 0; c.lagWhat = "replied";
    setState("thinking"); setErr("");
    try {
      const res = await fetch(`${API}?op=turn&call=${c.call}`, "audio" in body
        ? { method: "POST", headers: { "content-type": "audio/wav" }, body: encodeWav(body.audio) as Uint8Array<ArrayBuffer>, signal: ac.signal }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; fallback?: string };
        if (j.fallback === "speech" && SpeechRec()) { c.speech = true; setErr("Local Whisper is off: using this device's speech recognition."); return listenSpeech(); }
        throw new Error(j.error ?? `Failed (${res.status})`);
      }
      await readEvents(res.body, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      if (c.turn === ac) c.turn = null;
      if (!talking()) setState("listening");
      if (c.speech && c.handsFree && !ac.signal.aborted) setTimeout(() => { if (!talking()) listenSpeech(); else c.sources.at(-1)?.addEventListener("ended", () => listenSpeech(), { once: true }); }, 50);
    }
  }

  /** Fallback when the PC has no Whisper: one utterance through the browser's own recognizer (no barge-in in this mode). */
  function listenSpeech() {
    const Rec = SpeechRec(), c = r.current;
    if (!Rec || !c.call || c.recognizer) return;
    const rec = new Rec();
    rec.lang = "en-US"; rec.interimResults = false;
    let text = "";
    rec.onresult = (e) => { text = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" "); };
    rec.onend = rec.onerror = () => { if (c.recognizer === rec) c.recognizer = null; c.endedAt = performance.now(); if (text.trim()) void turn({ text }); };
    c.recognizer = rec;
    try { rec.start(); } catch { c.recognizer = null; }
  }

  function onFrame(frame: Float32Array) {
    const c = r.current, ctx = c.ctx!;
    if (c.speech) return;
    const frameMs = (frame.length / ctx.sampleRate) * 1000;
    if (c.ptt) { c.seg.push(frame); return; }
    if (!c.handsFree) return;
    const was = c.m.speaking;
    const v = callVad(c.m, rms(frame), zcr(frame), frameMs, talking());
    if (v.event === "start") { if (talking()) bargeIn(); c.seg = [...c.pre]; } // a reply still being worked out is replaced only if this turns out to be real speech (turn())
    if (v.m.speaking || v.event === "end") c.seg.push(frame); else { c.pre.push(frame); if (c.pre.length * frameMs > CALL_VAD.prerollSec * 1000) c.pre.shift(); }
    if (was && v.m.speaking) c.segSpeech = v.m.speechMs;
    c.m = v.m;
    const tooLong = v.m.speaking && c.seg.length * frameMs > CALL_VAD.maxSec * 1000;
    if (v.event === "end" || tooLong) {
      const seg = c.seg, speech = c.segSpeech;
      c.seg = []; c.segSpeech = 0;
      if (tooLong) c.m = { ...MIC_START, floor: c.m.floor };
      c.endedAt = performance.now() - (tooLong ? 0 : endSilenceMs(speech));
      if (worthSending(speech)) void turn({ audio: downsample(concat(seg), ctx.sampleRate) });
    }
  }

  useEffect(() => {
    const go = () => { if (phase === "idle" || phase === "ringing") void answer(true); };
    addEventListener(CAR_TALK, go);
    return () => removeEventListener(CAR_TALK, go);
  });

  async function answer(carMode = false) {
    const c = r.current;
    setCar(carMode);
    setPhase("connecting"); setErr(""); setLines([]); setLat("");
    if (location.hash === "#r-call") history.replaceState(null, "", location.pathname);
    try {
      // Both made inside this tap: iOS only allows audio and the mic from a user gesture.
      const ACtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      c.ctx = new ACtx();
      void c.ctx.resume();
      c.stream = await navigator.mediaDevices.getUserMedia(MIC);
      const src = c.ctx.createMediaStreamSource(c.stream);
      c.proc = c.ctx.createScriptProcessor(1024, 1, 1); // shortcut: deprecated but works in Safari; move to an AudioWorklet if it goes
      c.proc.onaudioprocess = (e) => onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(c.proc); c.proc.connect(c.ctx.destination); // outputs silence; it only runs while connected
      c.m = { ...MIC_START }; c.seg = []; c.pre = []; c.speech = false; c.firstPlay = 0; c.lagWhat = "spoke"; c.endedAt = performance.now(); // latency line: answer tap → ORBIT's voice
      const ac = (c.turn = new AbortController());
      const res = await fetch(`${API}?op=start${carMode ? "&car=1" : ""}`, { method: "POST", signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "ORBIT couldn't start the call");
      await readEvents(res.body, ac.signal); // the first sentence plays while the rest is still being voiced
      if (c.turn === ac) c.turn = null;
      if (!c.call) throw new Error("ORBIT couldn't start the call");
    } catch (e) {
      setErr(e instanceof Error && e.name === "NotAllowedError" ? "ORBIT needs the microphone: allow it for this page in Settings." : e instanceof Error ? e.message : "Couldn't start the call");
      hangUp(false);
    }
  }

  function hangUp(end = true) {
    const c = r.current;
    bargeIn();
    c.recognizer?.abort(); c.recognizer = null;
    c.proc?.disconnect(); c.stream?.getTracks().forEach((t) => t.stop()); void c.ctx?.close().catch(() => {});
    if (end && c.call) void fetch(`${API}?op=end&call=${c.call}`, { method: "POST", keepalive: true }).catch(() => {});
    Object.assign(c, { ctx: null, stream: null, proc: null, call: "", playAt: 0 });
    setPhase("idle"); setPtt(false);
  }
  useEffect(() => () => { if (r.current.call) hangUp(); }, []); // hang up when the screen goes away

  const pttDown = () => { const c = r.current; bargeIn(); c.recognizer?.abort(); c.seg = []; c.ptt = true; setPtt(true); setState("listening"); if (c.speech) listenSpeech(); };
  const pttUp = () => {
    const c = r.current;
    if (!c.ptt) return;
    c.ptt = false; setPtt(false);
    if (c.speech) { c.recognizer?.stop(); return; }
    const seg = c.seg; c.seg = [];
    const audio = c.ctx ? downsample(concat(seg), c.ctx.sampleRate) : null;
    c.endedAt = performance.now();
    if (audio && audio.length > 16000 / 3) void turn({ audio });
  };

  async function saveCheckin(v: string) {
    const res = await fetch(`${API}?op=settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkin: v }) }).catch(() => null);
    if (res?.ok) setCheckin(((await res.json()) as { checkin: string }).checkin);
  }

  if (!allowed) return null;
  if (phase === "idle") return compact ? null : (
    <section className="rm-sec" aria-labelledby="r-call">
      <h2 id="r-call" className="rm-label">Talk to ORBIT</h2>
      <p className="muted text-sm">ORBIT calls you when something needs you (max twice a day, never 23:00–08:00). Or call it now.</p>
      <button className="btn w-full" style={{ minHeight: 48 }} onClick={() => void answer()}>Call ORBIT</button>
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="muted">Daily check-in call</span>
        <input type="time" className="field" value={checkin} onChange={(e) => void saveCheckin(e.target.value)} aria-label="Daily check-in time" />
      </label>
      {checkin && <button className="chip" style={{ minHeight: 44 }} onClick={() => void saveCheckin("")}>No check-in</button>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );

  const label = phase === "ringing" ? "ORBIT wants to talk" : phase === "connecting" ? "Connecting…" : state === "talking" ? "ORBIT is talking" : state === "thinking" ? "Thinking…" : ptt ? "Go ahead…" : handsFree ? "Listening" : "Hold to talk";
  return (
    <div role="dialog" aria-modal="true" aria-label="Call with ORBIT" className="fixed inset-0 z-[100] flex flex-col items-center justify-between px-4"
      style={{ background: "radial-gradient(circle at 50% 30%, #0b2540 0%, var(--bg) 70%)", paddingTop: "max(2rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
      <div className="flex flex-col items-center gap-3 pt-6">
        <div aria-hidden className="rounded-full" style={{ width: 120, height: 120, border: "2px solid var(--cyan)", boxShadow: `0 0 ${state === "talking" && phase === "live" ? 60 : 20}px rgba(34,211,238,.5)`, transition: "box-shadow .3s" }} />
        <p className={`${car ? "text-3xl" : "text-lg"} font-semibold`} style={{ fontFamily: "var(--font-display)" }} aria-live="polite">{label}</p>
        {lat && !car && <p className="muted text-xs text-center">{lat}</p>}
      </div>
      {car ? ( // glanceable: only ORBIT's last line, in big type
        <div className="w-full max-w-md overflow-hidden text-center text-2xl font-semibold" style={{ maxHeight: "40vh" }} aria-live="polite">
          {err ? <p className="error" role="alert">{err}</p> : <p>{lines.findLast((l) => l.who === "orbit")?.text}</p>}
        </div>
      ) : (
      <div className="w-full max-w-md space-y-2 overflow-y-auto" style={{ maxHeight: "40vh" }} aria-live="polite">
        {lines.map((l, i) => <p key={i} className={`text-sm ${l.who === "you" ? "text-right muted" : ""}`}>{l.text}</p>)}
        {err && <p className="error text-sm" role="alert">{err}</p>}
      </div>
      )}
      {phase === "ringing" ? (
        <div className="flex w-full max-w-md gap-3">
          <button className="chip flex-1" style={{ minHeight: 56 }} onClick={() => { setPhase("idle"); if (location.hash === "#r-call") history.replaceState(null, "", location.pathname); }}>Not now</button>
          <button className="btn flex-1" style={{ minHeight: 56 }} onClick={() => void answer()}>Answer</button>
        </div>
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <button className="btn w-full select-none" style={{ minHeight: 72, touchAction: "none", WebkitUserSelect: "none" }} disabled={phase !== "live"}
            onPointerDown={pttDown} onPointerUp={pttUp} onPointerCancel={pttUp} onPointerLeave={pttUp} aria-pressed={ptt}>
            {ptt ? "Release to send" : "Hold to talk"}
          </button>
          <div className="flex w-full gap-3">
            <button className="chip flex-1" style={{ minHeight: 48 }} aria-pressed={handsFree} onClick={() => { const v = !handsFree; r.current.handsFree = v; setHandsFree(v); if (v && r.current.speech) listenSpeech(); }}>
              Hands-free {handsFree ? "on" : "off"}
            </button>
            <button className={`btn danger flex-1 ${car ? "text-2xl" : ""}`} style={{ minHeight: car ? 96 : 48 }} onClick={() => hangUp()}>Hang up</button>
          </div>
        </div>
      )}
    </div>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Review = { on: boolean; day: number; at: string };
/** Profile: the weekly review call (off until he turns it on). ORBIT rings once at this time; unanswered, it waits in the next morning's brief. */
export function WeeklyReviewSetting() {
  const [v, setV] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch(API).then((r) => (r.ok ? r.json() : null)).then((j: { review?: Review } | null) => j?.review && setV(j.review), () => {}); }, []);
  async function save(next: Review) {
    setErr("");
    const res = await fetch(`${API}?op=settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ review: next }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { review?: Review; error?: string } | undefined;
    if (res?.ok && j?.review) setV(j.review); else setErr(j?.error ?? "Could not save");
  }
  if (!v) return null;
  return (
    <section className="card space-y-2" aria-labelledby="weekly-call">
      <h2 id="weekly-call" className="text-sm font-semibold">Weekly review call</h2>
      <p className="muted text-sm">ORBIT rings once and talks you through the week: what got done, what&apos;s waiting, one thing it noticed, and your top 3 for next week (saved as goals only after you say yes). It never approves anything on the call. Missed? It waits in the next morning&apos;s brief.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.on} onChange={(e) => void save({ ...v, on: e.target.checked })} /> Call me for a weekly review</label>
      <div className="flex flex-wrap gap-2">
        <select className="field" value={v.day} disabled={!v.on} onChange={(e) => void save({ ...v, day: Number(e.target.value) })} aria-label="Review day">
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <input type="time" className="field" min="08:00" max="22:59" value={v.at} disabled={!v.on} onChange={(e) => e.target.value && void save({ ...v, at: e.target.value })} aria-label="Review time" />
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
