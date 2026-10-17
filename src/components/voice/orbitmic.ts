"use client";
// ORBIT mic: one always-open, echo-cancelled mic stream for the whole hands-free session (no gaps between utterances),
// a VAD on every frame (audio-pure micStep), each speech segment sent to local Whisper as a 16 kHz WAV. Audio stays on
// this PC; nothing is stored.
import { voiceLevel } from "./bus";
import { ASR_RATE, concat, downsample, MAX_AUDIO_SEC, MIC_START, micStep, rms, zcr } from "@/lib/audio-pure";
import { MIC, resumeOnGesture } from "./voiceprint";

const PREROLL_MS = 300, BARGE_MS = 300, MIN_SPEECH_MS = 300; // shorter = a cough or a door: never sent to Whisper

export type OrbitMicEvents = {
  onStart(): void; // speech began
  /** Speech ended. Always fires after onStart: audio null when it was too short to send. overOrbit: it began while ORBIT
   *  talked (maybe echo); barged: onBarge fired for it. */
  onSegment(audio: Float32Array | null, info: { overOrbit: boolean; barged: boolean }): void;
  onBarge(): void; // >300 ms clearly louder than ORBIT's own voice coming back, while ORBIT talks (only if bargeOk())
  bargeOk(): boolean; // "Interrupt by voice (headphones)" is on
  speaking(): boolean; // is ORBIT talking now
  onSuspended(suspended: boolean): void; // the AudioContext waits for a click/key before it hears anything
};

/** Resolves once the mic is open; rejects (NotAllowedError…) if it can't be. stop() releases everything. */
export async function startOrbitMic(ev: OrbitMicEvents): Promise<{ stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia(MIC);
  let ctx: AudioContext | null = null, src: MediaStreamAudioSourceNode, proc: ScriptProcessorNode, unhook = () => {};
  const stop = () => {
    if (proc) proc.onaudioprocess = null;
    unhook();
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
    voiceLevel.mic = 0;
  };
  try {
    ctx = new AudioContext();
    unhook = resumeOnGesture(ctx, ev.onSuspended);
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1); // shortcut: deprecated but simplest (same as whisper.ts); AudioWorklet if Chrome removes it
  } catch (e) { stop(); throw e; }
  const rate = ctx.sampleRate;
  let m = MIC_START, seg: Float32Array[] = [], pre: Float32Array[] = [], barged = false, overOrbit = false, speechMs = 0;
  let ttsFloor = 0, louderMs = 0; // ORBIT's own voice as the mic hears it (Windows TTS can bypass echo cancellation)
  proc.onaudioprocess = (e) => {
    const frame = new Float32Array(e.inputBuffer.getChannelData(0)), frameMs = (frame.length / rate) * 1000, level = rms(frame);
    voiceLevel.mic = Math.min(1, level * 5); // drives the mic ring
    const talking = ev.speaking();
    if (talking) {
      louderMs = ttsFloor && level > ttsFloor * 2 ? louderMs + frameMs : 0;
      if (louderMs < frameMs * 2) ttsFloor = ttsFloor ? ttsFloor * 0.95 + level * 0.05 : level; // learn from frames that aren't a barge
    } else { ttsFloor = 0; louderMs = 0; }
    const r = micStep(m, level, zcr(frame), frameMs);
    m = r.m;
    if (r.event === "start") { seg = [...pre, frame]; pre = []; barged = false; overOrbit = talking; ev.onStart(); return; }
    if (m.speaking) {
      seg.push(frame);
      speechMs = m.speechMs;
      if (!barged && talking && louderMs >= BARGE_MS && ev.bargeOk()) { barged = true; ev.onBarge(); }
      if (seg.length * frameMs < MAX_AUDIO_SEC * 1000) return;
      m = { ...MIC_START, floor: m.floor }; // too long: cut here, keep listening
    } else if (r.event !== "end") {
      pre.push(frame);
      while (pre.length * frameMs > PREROLL_MS) pre.shift();
      return;
    }
    const audio = speechMs >= MIN_SPEECH_MS ? downsample(concat(seg), rate).slice(0, MAX_AUDIO_SEC * ASR_RATE) : null;
    seg = [];
    ev.onSegment(audio, { overOrbit, barged });
    speechMs = 0;
  };
  try { src.connect(proc); proc.connect(ctx.destination); } catch (e) { stop(); throw e; } // a ScriptProcessor only runs while connected; it outputs silence
  return { stop };
}
