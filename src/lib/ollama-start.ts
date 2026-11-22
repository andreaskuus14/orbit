// Starts Ollama (`ollama serve`, hidden, loopback only) when the local brain or OCR needs it and it isn't answering: at server
// start, when the Doctor runs, every system-health tick and right before a local call. Rules and the Doctor line: ollama-start-pure.ts.
// No journal/LIFE text here: this file only starts a program and asks for its model list. ORBIT_OLLAMA_AUTOSTART=0 turns it off.
import { existsSync } from "node:fs";
import { OLLAMA_URL, localModelName } from "./local-model-pure.ts";
import { ocrConfig } from "./ocr-pure.ts";
import { ollamaExeCandidates, ollamaWanted, type OllamaStart } from "./ollama-start-pure.ts";

const G = globalThis as unknown as { __orbitOllama?: { last: OllamaStart; run?: Promise<OllamaStart>; tried: number } };
const st = (G.__orbitOllama ??= { last: { state: "running" }, tried: 0 });
const RETRY_MS = 60_000, WAIT_MS = 20_000;

const up = () => fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);

/** Spawn one candidate; resolves false at once when the program isn't there (ENOENT). */
async function spawnServe(exe: string): Promise<{ ok: boolean; why?: string }> {
  if (exe !== "ollama" && !existsSync(exe)) return { ok: false };
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    let done = false;
    const child = spawn(exe, ["serve"], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, OLLAMA_HOST: new URL(OLLAMA_URL).host } });
    child.on("error", (e: NodeJS.ErrnoException) => { if (!done) { done = true; resolve({ ok: false, why: e.code === "ENOENT" ? undefined : e.message }); } });
    child.on("spawn", () => { if (!done) { done = true; child.unref(); resolve({ ok: true }); } });
    child.on("exit", (code) => { if (!done) { done = true; resolve({ ok: false, why: `it stopped right away (exit ${code})` }); } });
  });
}

async function start(reason: string): Promise<OllamaStart> {
  if (await up()) return { state: "running" };
  if (process.env.ORBIT_OLLAMA_AUTOSTART?.trim() === "0") return { state: "off" };
  const t0 = Date.now();
  let found = false, why = "";
  for (const exe of ollamaExeCandidates(process.env, process.platform)) {
    const r = await spawnServe(exe);
    if (r.why) { found = true; why = r.why; }
    if (!r.ok) continue;
    found = true;
    while (Date.now() - t0 < WAIT_MS) {
      await new Promise((w) => setTimeout(w, 1000));
      if (await up()) { console.log(`[orbit] Ollama wasn't running (${reason}); started it (${Date.now() - t0} ms)`); return { state: "started", at: Date.now(), ms: Date.now() - t0 }; }
    }
    why = `it didn't answer at ${OLLAMA_URL} within ${WAIT_MS / 1000} s`;
    break;
  }
  if (!found) return { state: "missing" };
  console.warn(`[orbit] Ollama couldn't be started: ${why}`);
  return { state: "failed", at: Date.now(), why };
}

/** Make sure Ollama answers when something in ORBIT needs it. At most one start attempt a minute; never throws. */
export async function ensureOllama(reason: string): Promise<OllamaStart> {
  if (!ollamaWanted(localModelName(process.env), ocrConfig(process.env).on)) return (st.last = { state: "unused" });
  if (st.run) return st.run;
  if (st.last.state === "failed" && Date.now() - st.tried < RETRY_MS) return (await up()) ? (st.last = { state: "running" }) : st.last;
  st.tried = Date.now();
  st.run = start(reason).catch((e) => ({ state: "failed" as const, at: Date.now(), why: e instanceof Error ? e.message : String(e) }))
    .then((r) => (st.last = r.state === "running" && st.last.state === "started" ? st.last : r)).finally(() => { st.run = undefined; });
  return st.run;
}
