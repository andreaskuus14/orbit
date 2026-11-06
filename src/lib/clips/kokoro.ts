// Kokoro-82M on the CPU for story narration and voice calls, run in a worker thread (kokoro-worker.mjs says why). One worker per
// process, started on first use; if it dies (a model error, or phonemizer's handler ending it) its waiting requests fail and the
// next request starts a new one. Tested in tests/briefing-crash-policy.test.ts.
import { Worker } from "node:worker_threads";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeWav } from "../local-ai-pure.ts";

export type Spoken = { audio: Float32Array; sampling_rate: number; save(f: string): Promise<void> };
export type Kokoro = { generate(t: string, o: { voice: string; speed?: number }): Promise<Spoken> };
// By path from the app folder (launch.ps1 and tests run there): a plain file Node loads, so webpack never bundles kokoro-js.
const WORKER = () => path.join(process.cwd(), "src/lib/clips/kokoro-worker.mjs");
const g = globalThis as unknown as { __orbitKokoro?: Promise<Kokoro> };

export function kokoroTts(): Promise<Kokoro> {
  return (g.__orbitKokoro ??= startKokoro(WORKER(), () => { g.__orbitKokoro = undefined; }));
}

/** Starts one worker; resolves once its model is ready. `gone` runs when it stops, so the next call starts a fresh one. */
export function startKokoro(file: string, gone: () => void = () => {}): Promise<Kokoro> {
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { execArgv: [] }); // none of the server's Node flags
    const idle = () => { if (!waiting.size) w.unref(); }; // keeps the process alive only while loading or answering
    const waiting = new Map<number, { ok: (s: Spoken) => void; no: (e: Error) => void }>();
    let next = 0, ready = false;
    const stop = (e: Error) => {
      gone();
      for (const p of waiting.values()) p.no(e);
      waiting.clear();
      if (!ready) reject(e);
    };
    w.on("error", (e) => stop(new Error(`The voice model failed: ${e.message}`)));
    w.on("exit", (code) => stop(new Error(`The voice model stopped (exit ${code})`)));
    w.on("message", (m: { ready?: true; fatal?: string; id?: number; audio?: Float32Array; rate?: number; error?: string }) => {
      if (m.ready) { ready = true; idle(); resolve(api); return; }
      if (m.fatal) return stop(new Error(`The voice model couldn't load: ${m.fatal}`));
      const p = m.id === undefined ? undefined : waiting.get(m.id);
      if (!p) return;
      waiting.delete(m.id!);
      idle();
      if (m.error || !m.audio) return p.no(new Error(m.error ?? "The voice model returned no audio"));
      const audio = m.audio, rate = m.rate ?? 24000;
      p.ok({ audio, sampling_rate: rate, save: (f) => writeFile(f, encodeWav(audio, rate)) });
    });
    const api: Kokoro = {
      generate: (text, o) => new Promise((ok, no) => {
        const id = ++next;
        waiting.set(id, { ok, no });
        w.ref();
        w.postMessage({ id, text, voice: o.voice, speed: o.speed });
      }),
    };
  });
}
