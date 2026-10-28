"use client";
// Conversation mode with Chrome or Local hands-free: those recognizers give no audio level, so a second echo-cancelled mic
// tap watches the level while ORBIT talks and calls onBarge when the owner talks over it (barge-pure). Nothing is recorded.
import { rms } from "@/lib/audio-pure";
import { BARGE_START, bargeStep } from "@/lib/barge-pure";
import { MIC, resumeOnGesture } from "./voiceprint";

/** Returns a stop function; a missing mic just means no voice barge-in ("stop" still works). */
export function startBargeTap(speaking: () => boolean, onBarge: () => void): () => void {
  let stopped = false, release = () => {};
  navigator.mediaDevices?.getUserMedia(MIC).then((stream) => {
    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { stream.getTracks().forEach((t) => t.stop()); return; }
    const unhook = resumeOnGesture(ctx);
    release = () => { unhook(); stream.getTracks().forEach((t) => t.stop()); void ctx.close().catch(() => {}); };
    if (stopped) return release();
    const proc = ctx.createScriptProcessor(1024, 1, 1); // shortcut: deprecated, same as orbitmic.ts; AudioWorklet if Chrome removes it
    let b = BARGE_START, fired = false;
    proc.onaudioprocess = (e) => {
      const frame = e.inputBuffer.getChannelData(0), talking = speaking();
      const r = bargeStep(b, rms(frame), (frame.length / ctx.sampleRate) * 1000, talking); // ~21 ms frames at 48 kHz
      b = r.b;
      if (!talking) fired = false;
      else if (r.barge && !fired) { fired = true; onBarge(); }
    };
    try { ctx.createMediaStreamSource(stream).connect(proc); proc.connect(ctx.destination); } catch { release(); }
  }).catch(() => { /* no mic: no voice barge-in */ });
  return () => { stopped = true; release(); };
}
