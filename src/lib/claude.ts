import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStreamJsonLine, takeLines, type StreamResult } from "./streamjson.ts";
import { streamJsonInput } from "./attach-pure.ts";

/** An image sent to the model with the prompt (validated by attach-pure). */
export type PromptImage = { type: string; data: Uint8Array };

// CORE runs on the local Claude Code CLI (`claude -p`) under your own Claude login, so there is no API key
// and no per-token bill. ORBIT must therefore run on the machine where `claude` is installed and signed in.
export const CLAUDE_BIN = process.env.ORBIT_CLAUDE_BIN || "claude";
export const MODEL = process.env.ORBIT_MODEL || "sonnet";
/** Stronger (slower) model for the few judgement calls where quality matters most: final clip ranking, niche research. */
export const SMART_MODEL = process.env.ORBIT_MODEL_SMART || "opus";
/** Quick model for CORE's short chit-chat turns that need no tools (see pickModel in core-ui.ts). */
export const FAST_MODEL = process.env.ORBIT_MODEL_FAST || "haiku";
const TIMEOUT_MS = 120_000;
const WIN = process.platform === "win32";
const HINT = "Install Claude Code and run `claude` once to sign in (or set ORBIT_CLAUDE_BIN to its full path).";

// At most 3 `claude` processes at once across the whole server; the rest queue in two lanes. Foreground (CORE chat,
// voice) is served first and background (agents, automations, briefings, clips) may hold at most limit-1 slots, so a
// chat never waits behind a pile of agent work. Kept on globalThis so dev hot reloads don't create a second limit.
const MAX_CLI = Number(process.env.ORBIT_CLAUDE_CONCURRENCY) || 3;
const gl = globalThis as unknown as { __orbitClaudeLanes?: ReturnType<typeof createLaneLimiter> };
const cliSlot = (gl.__orbitClaudeLanes ??= createLaneLimiter(MAX_CLI));

export type Lane = "foreground" | "background";
export class BusyError extends Error {}

export function createLaneLimiter(max: number, maxBackgroundWaiting = 20) {
  let active = 0, bgActive = 0;
  const bgMax = Math.max(1, max - 1); // with a limit of 1 there is nothing to reserve
  const waiting: Record<Lane, (() => void)[]> = { foreground: [], background: [] };
  const pump = () => {
    while (active < max) {
      const fg = waiting.foreground.length > 0;
      if (!fg && !(waiting.background.length && bgActive < bgMax)) return;
      active++;
      if (!fg) bgActive++;
      (fg ? waiting.foreground : waiting.background).shift()!();
    }
  };
  return async function run<T>(lane: Lane, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const q = waiting[lane];
    if (lane === "background" && q.length >= maxBackgroundWaiting) throw new BusyError(`ORBIT is busy: ${q.length} Claude jobs are already waiting. Try again in a few minutes.`);
    await new Promise<void>((resolve, reject) => {
      const go = () => { signal?.removeEventListener("abort", stop); resolve(); };
      const stop = () => { const i = q.indexOf(go); if (i >= 0) { q.splice(i, 1); reject(signal?.reason); } };
      q.push(go);
      signal?.addEventListener("abort", stop, { once: true });
      pump();
    });
    try { return await fn(); }
    finally { active--; if (lane === "background") bgActive--; pump(); }
  };
}

/* Agent task budgets: one per task tree (a task and everything it delegates), shared by all its Claude calls. */
export class BudgetError extends Error {}
export function createBudget(ms = 8 * 60_000, calls = 12) {
  return { signal: AbortSignal.timeout(ms), minutes: ms / 60_000, calls, used: 0 };
}
export type Budget = ReturnType<typeof createBudget>;

/** Call before every Claude call of a task: throws when the task was stopped or its budget is spent. */
export function chargeCall(b: Budget, signal: AbortSignal) {
  if (b.signal.aborted) throw new BudgetError(`Budget exceeded: the ${b.minutes}-minute limit was reached`);
  signal.throwIfAborted();
  if (b.used >= b.calls) throw new BudgetError(`Budget exceeded: all ${b.calls} Claude calls were used`);
  b.used++;
}

/** Why a task stopped early: its budget ran out, it was cancelled, or neither (a normal error). */
export function stopKind(b: Budget, signal: AbortSignal, e: unknown): "budget" | "cancelled" | null {
  if (e instanceof BudgetError || b.signal.aborted) return "budget";
  return signal.aborted ? "cancelled" : null;
}

/** The result of a stopped task: what it had already finished, so stopping never throws work away silently. */
export function stoppedReport(headline: string, steps: { step: string; detail: string; ok: boolean }[], kids: { agent: string; title: string; status: string }[]) {
  const done = [
    ...steps.filter((s) => s.ok && !["think", "verify", "error"].includes(s.step) && !s.detail.endsWith("working…")).map((s) => `- ${s.step}: ${s.detail.slice(0, 160)}`),
    ...kids.filter((k) => k.status === "done" || k.status === "awaiting_approval").map((k) => `- ${k.agent} finished sub-task "${k.title}"`),
  ];
  return `**${headline}.** ${done.length ? `Completed before stopping:\n${done.join("\n")}` : "Nothing was completed yet."}`;
}

export type ClaudeResult = { text: string; inputTokens: number; outputTokens: number; ms: number };

/** Shared setup for every CLI call: system prompt in a temp dir, fixed flags, all tools disabled. */
async function prepare(system: string, format: string[], model = MODEL) {
  if (!/^[\w.:-]+$/.test(model)) throw new Error("ORBIT_MODEL / ORBIT_MODEL_SMART / ORBIT_MODEL_FAST contains invalid characters");
  // The system prompt goes in a file and the user prompt on stdin, so no user text is ever on the command line.
  const dir = await mkdtemp(join(tmpdir(), "orbit-"));
  const sysFile = join(dir, "system.txt");
  await writeFile(sysFile, system, "utf8");
  const q = (a: string) => (WIN ? `"${a}"` : a); // Windows needs a shell to run claude.cmd, so quote args there
  const args = ["-p", ...format, "--tools", q(""), "--no-session-persistence",
    // Ignore user-level plugins/hooks/skills and all MCP connectors (CORE must have no tools) but keep the login. Not --bare: it skips OAuth.
    "--setting-sources", "local", "--disable-slash-commands", "--strict-mcp-config", "--model", model, "--system-prompt-file", q(sysFile)];
  const opts = { stdio: ["pipe", "pipe", "pipe"] as ("pipe")[], env: process.env, cwd: dir, windowsHide: true };
  // On Windows, claude may be claude.cmd, which needs a shell; pass one pre-quoted command string (args hold no user text).
  const start = () => (WIN ? spawn(`${q(CLAUDE_BIN)} ${args.join(" ")}`, { ...opts, shell: true }) : spawn(CLAUDE_BIN, args, opts));
  return { dir, start };
}

/** Not awaited and never throws: after a timeout kill, Windows keeps the dir locked (EPERM) until the tree exits,
 *  and a cleanup error must not replace the real one. rm itself retries EPERM/EBUSY with backoff. */
function removeTempDir(dir: string) {
  rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

/** With shell:true on Windows, kill() only ends cmd.exe and leaves claude running: kill the whole tree there. */
function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  if (WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill("SIGKILL"));
  else child.kill("SIGKILL");
}

export type AskOpts = { lane?: Lane; signal?: AbortSignal; model?: string; images?: PromptImage[] };

/** One headless Claude Code call with all tools disabled (it can only read the prompt and answer). Aborting `signal` kills the CLI. */
export function askClaude(prompt: string, system: string, { lane = "background", signal, model, images = [] }: AskOpts = {}): Promise<ClaudeResult> {
  return cliSlot(lane, () => runClaudeStream(prompt, system, () => {}, signal, model, images), signal);
}

/** Like askClaude, but calls onDelta with each text chunk as it is generated. Aborting `signal` kills the CLI. */
export function askClaudeStream(prompt: string, system: string, onDelta: (text: string) => void, signal?: AbortSignal, lane: Lane = "background", model?: string, images: PromptImage[] = []): Promise<ClaudeResult> {
  return cliSlot(lane, () => runClaudeStream(prompt, system, onDelta, signal, model, images), signal);
}

async function runClaudeStream(prompt: string, system: string, onDelta: (text: string) => void, signal?: AbortSignal, model?: string, images: PromptImage[] = []): Promise<ClaudeResult> {
  signal?.throwIfAborted();
  const t0 = Date.now();
  // With images, stdin carries one stream-json user message (image blocks + text); tools stay disabled.
  const input = images.length ? ["--input-format", "stream-json"] : [];
  const { dir, start } = await prepare(system, [...input, "--output-format", "stream-json", "--verbose", "--include-partial-messages"], model);
  try {
    return await new Promise<ClaudeResult>((resolve, reject) => {
      const child = start();
      let buf = "";
      let err = "";
      let streamed = "";
      let result: StreamResult | null = null;
      const onAbort = () => { killTree(child); reject(new DOMException("Stopped", "AbortError")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const ms = model === SMART_MODEL && model !== MODEL ? 3 * TIMEOUT_MS : TIMEOUT_MS; // the stronger model thinks longer
      const timer = setTimeout(() => { killTree(child); reject(new Error(`Claude Code timed out after ${ms / 60_000} minutes`)); }, ms);
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); };
      const handle = (line: string) => {
        const ev = parseStreamJsonLine(line);
        if (ev?.delta) { streamed += ev.delta; onDelta(ev.delta); }
        if (ev?.result) result = ev.result;
      };
      child.stdout.setEncoding("utf8"); // decodes multi-byte characters split across chunks
      child.stdout.on("data", (d: string) => {
        const { lines, rest } = takeLines(buf + d);
        buf = rest;
        lines.forEach(handle);
      });
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { done(); reject(new Error(`Could not start "${CLAUDE_BIN}": ${e.message}. ${HINT}`)); });
      child.on("close", (code) => {
        done();
        if (buf.trim()) handle(buf);
        const r = result as StreamResult | null;
        if (!r) return reject(new Error(`Claude Code failed: ${err.slice(0, 300) || `exit ${code}`}. ${HINT}`));
        if (r.isError || code !== 0) return reject(new Error(r.text || err || `claude exited ${code}`));
        resolve({ text: (r.text || streamed).trim(), inputTokens: r.inputTokens, outputTokens: r.outputTokens, ms: Date.now() - t0 });
      });
      child.stdin.on("error", () => { /* EPIPE when the CLI is killed mid-write; the close handler reports it */ });
      child.stdin.end(images.length ? streamJsonInput(prompt, images) : prompt);
    });
  } finally {
    removeTempDir(dir);
  }
}

/** Token log only; cost is 0 because the subscription is flat-rate. */
export async function recordUsage(sb: SupabaseClient, userId: string, purpose: string, r: ClaudeResult, model = MODEL) {
  const { error } = await sb.from("usage").insert({
    user_id: userId, model, purpose, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: 0,
  });
  if (error) console.error("[orbit] failed to record usage", error);
}

/** Append a universe event. The galaxy animates from these via Supabase Realtime. */
export async function emit(sb: SupabaseClient, userId: string, type: string, planet: string, payload: Record<string, unknown> = {}) {
  const { error } = await sb.from("events").insert({ user_id: userId, type, planet, payload });
  if (error) console.error("[orbit] failed to emit event", type, error);
}
