// Kokoro-82M on the CPU for story narration and voice calls, run in a child process (kokoro-worker.mjs says why). One per ORBIT
// process, started on first use; if it dies (a model error, or phonemizer's handler ending it) its waiting requests fail and the
// next request starts a new one. Tested in tests/briefing-crash-policy.test.ts.
import { fork } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeWav } from "../local-ai-pure.ts";

export type Spoken = { audio: Float32Array; sampling_rate: number; save(f: string): Promise<void> };
export type Kokoro = { generate(t: string, o: { voice: string; speed?: number }): Promise<Spoken> };
// By path from the app folder (launch.ps1 and tests run there): a plain file Node runs, so webpack never bundles kokoro-js.
const WORKER = () => path.join(process.cwd(), "src/lib/clips/kokoro-worker.mjs");
const g = globalThis as unknown as { __orbitKokoro?: Promise<Kokoro> };

export function kokoroTts(): Promise<Kokoro> {
  return (g.__orbitKokoro ??= startKokoro(WORKER(), () => { g.__orbitKokoro = undefined; }));
}

type Msg = { ready?: true; fatal?: string; id?: number; audio?: Float32Array; rate?: number; error?: string };
/** Starts one voice process; resolves once its model is ready. `gone` runs when it stops, so the next call starts a fresh one. */
export function startKokoro(file: string, gone: () => void = () => {}): Promise<Kokoro> {
  return new Promise((resolve, reject) => {
    // advanced serialization: the audio crosses as a Float32Array. None of the server's Node flags; its output goes to ORBIT's log.
    const child = fork(file, [], { serialization: "advanced", execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const waiting = new Map<number, { ok: (s: Spoken) => void; no: (e: Error) => void }>();
    const channel = () => (child as unknown as { channel?: { ref(): void; unref(): void } }).channel;
    const idle = () => { if (!waiting.size) { child.unref(); channel()?.unref(); } }; // keeps ORBIT's process alive only while busy
    let next = 0, ready = false, stopped = false;
    const stop = (e: Error) => {
      if (stopped) return;
      stopped = true;
      gone();
      for (const p of waiting.values()) p.no(e);
      waiting.clear();
      if (!ready) reject(e);
      child.kill();
    };
    child.on("error", (e) => stop(new Error(`The voice model failed: ${e.message}`)));
    child.on("exit", (code, signal) => stop(new Error(`The voice model stopped (${signal ?? `exit ${code}`})`)));
    child.on("message", (m: Msg) => {
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
        if (stopped) return no(new Error("The voice model stopped"));
        const id = ++next;
        waiting.set(id, { ok, no });
        child.ref(); channel()?.ref();
        child.send({ id, text, voice: o.voice, speed: o.speed });
      }),
    };
  });
}
