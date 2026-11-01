// The local brain's IO: Ollama on this PC (rules: local-model-pure.ts). Used by claude.ts for the offline fallback and directly
// for private LIFE work. This file must never import claude.ts: private text has no path to Claude from here (tests/local-llm.test.ts).
import { OLLAMA_URL, journalReflect, localModelName, localStatus, ollamaAnswer, ollamaRequest, privateBlocked, PRIVATE_LABEL, type LocalStatus } from "./local-model-pure.ts";

export const LOCAL_MODEL = localModelName(process.env);

/** One plain Ollama chat call (no tools, no streaming) to this PC. */
export async function chatLocal(prompt: string, system: string, o: { signal?: AbortSignal; timeoutMs?: number; numCtx?: number } = {}) {
  const t0 = Date.now(), ms = o.timeoutMs ?? 120_000;
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ollamaRequest(LOCAL_MODEL, system, prompt, o.numCtx)),
    signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`Local model (Ollama) answered ${res.status}`);
  return { ...ollamaAnswer(await res.json()), ms: Date.now() - t0, local: true as const };
}

const tags = () => fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null), () => null);

/** Ollama not answering: start `ollama serve` hidden, once a minute at most (the Windows installer usually runs it in the tray already). */
const G = globalThis as unknown as { __orbitOllamaStart?: number };
async function startOllama() {
  if (Date.now() - (G.__orbitOllamaStart ?? 0) < 60_000) return;
  G.__orbitOllamaStart = Date.now();
  const { spawn } = await import("node:child_process");
  const child = spawn("ollama", ["serve"], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, OLLAMA_HOST: new URL(OLLAMA_URL).host } });
  child.on("error", () => {}); // not installed: the health line already says how to set it up
  child.unref();
}

/** Health for OPERATIONS → Local AI; starts Ollama in the background when it's down (the next check shows it). */
export async function localBrainHealth(): Promise<LocalStatus & { private: boolean }> {
  const t = LOCAL_MODEL ? await tags() : null;
  if (LOCAL_MODEL && t === null) void startOllama();
  return { ...localStatus(LOCAL_MODEL, t), private: !privateBlocked({ model: LOCAL_MODEL, optIn: process.env.ORBIT_LOCAL_PRIVATE }) };
}

/** LIFE → Journal "Reflect": the last 7 days of the journal, read by the local model only. Nothing is saved. */
export async function reflectJournal(days: { date: string; text: string }[], signal?: AbortSignal): Promise<{ text: string; model: string; label: string } | { error: string }> {
  const no = privateBlocked({ model: LOCAL_MODEL, optIn: process.env.ORBIT_LOCAL_PRIVATE });
  if (no) return { error: no };
  const call = journalReflect(days);
  if (!call) return { error: "Nothing in the journal for the last 7 days yet." };
  try {
    const r = await chatLocal(call.prompt, call.system, { signal, timeoutMs: 180_000, numCtx: 8192 });
    return { text: r.text, model: LOCAL_MODEL, label: PRIVATE_LABEL };
  } catch (e) {
    if ((await tags()) === null) void startOllama();
    return { error: `The local model didn't answer (${e instanceof Error ? e.message : String(e)}). Is Ollama running? Try again in a minute.` };
  }
}
