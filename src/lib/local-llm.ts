// The local brain's IO: Ollama on this PC (rules: local-model-pure.ts). Used by claude.ts for the offline fallback and by vault intake.
// This file must never import claude.ts, and no journal/LIFE text may reach it (AGENTS.md rule 6; tests/local-llm.test.ts, tests/life-planning.test.ts).
import { OLLAMA_URL, TIGHT_VRAM_MB, installedModels, localModelName, localStatus, ollamaAnswer, ollamaRequest, pickLocalModel, type LocalPick, type LocalStatus } from "./local-model-pure.ts";
import { gpuNow } from "./gpu-lock.ts";

/** The configured model (ORBIT_LOCAL_LLM_MODEL); resolveLocalModel() says which installed one actually answers. */
export const LOCAL_MODEL = localModelName(process.env);

/** Free VRAM in MiB on the first NVIDIA GPU, or null (no nvidia-smi, not NVIDIA, slow). Cached 10 s. */
const V = globalThis as unknown as { __orbitVram?: { at: number; mb: number | null } };
async function freeVramMb(): Promise<number | null> {
  if (V.__orbitVram && Date.now() - V.__orbitVram.at < 10_000) return V.__orbitVram.mb;
  const mb = await new Promise<number | null>((resolve) => {
    import("node:child_process").then(({ execFile }) => {
      execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { timeout: 2000, windowsHide: true }, (err, out) => {
        const n = err ? NaN : Number.parseInt(String(out).split(/\r?\n/)[0], 10);
        resolve(Number.isFinite(n) ? n : null);
      });
    }, () => resolve(null));
  });
  V.__orbitVram = { at: Date.now(), mb };
  return mb;
}

/** Another job (pictures, 3D, video, NVENC render...) holds the shared GPU lease, or free VRAM is below TIGHT_VRAM_MB. */
async function gpuTight(): Promise<boolean> {
  if (gpuNow().busy) return true;
  const mb = await freeVramMb();
  return mb !== null && mb < TIGHT_VRAM_MB;
}

/** Installed models, cached 15 s (null: Ollama not reachable). */
const T = globalThis as unknown as { __orbitOllamaTags?: { at: number; t: unknown } };
async function cachedTags() {
  if (T.__orbitOllamaTags && Date.now() - T.__orbitOllamaTags.at < 15_000) return T.__orbitOllamaTags.t;
  const t = await tags();
  T.__orbitOllamaTags = { at: Date.now(), t };
  return t;
}

/** Which model answers right now: the configured one; its smaller sibling (qwen3.5:9b -> qwen3.5:4b) while the GPU is shared; or
 *  whatever is installed when the configured one isn't pulled. Ollama unreachable: the configured name (the call itself then fails). */
export async function resolveLocalModel(): Promise<LocalPick> {
  if (!LOCAL_MODEL) return { model: "" };
  const t = await cachedTags();
  if (t === null) return { model: LOCAL_MODEL };
  return pickLocalModel({ configured: LOCAL_MODEL, installed: installedModels(t), tight: await gpuTight() });
}

/** One plain Ollama chat call (no tools, no streaming) to this PC. */
export async function chatLocal(prompt: string, system: string, o: { signal?: AbortSignal; timeoutMs?: number; numCtx?: number } = {}) {
  const t0 = Date.now(), ms = o.timeoutMs ?? 120_000;
  const pick = await resolveLocalModel();
  if (!pick.model) throw new Error(`Local model isn't available${pick.hint ? `. ${pick.hint}` : ""}`);
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ollamaRequest(pick.model, system, prompt, o.numCtx)),
    signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`Local model (Ollama) answered ${res.status}`);
  return { ...ollamaAnswer(await res.json()), ms: Date.now() - t0, local: true as const, model: pick.model };
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
export async function localBrainHealth(): Promise<LocalStatus & { using?: string }> {
  const t = LOCAL_MODEL ? await tags() : null;
  if (LOCAL_MODEL && t === null) void startOllama();
  const st = localStatus(LOCAL_MODEL, t);
  if (st.state !== "ok" && st.state !== "fallback") return st;
  const using = (await resolveLocalModel()).model;
  return using && using !== LOCAL_MODEL && st.state === "ok" ? { ...st, text: `${st.text} (using ${using} while the GPU is busy)`, using } : { ...st, using };
}
