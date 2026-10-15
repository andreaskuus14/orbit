import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStreamJsonLine, takeLines, type StreamResult } from "./streamjson.ts";
import { createLimiter } from "./pure.ts";

// CORE runs on the local Claude Code CLI (`claude -p`) under your own Claude login, so there is no API key
// and no per-token bill. ORBIT must therefore run on the machine where `claude` is installed and signed in.
export const CLAUDE_BIN = process.env.ORBIT_CLAUDE_BIN || "claude";
export const MODEL = process.env.ORBIT_MODEL || "sonnet";
const TIMEOUT_MS = 120_000;
const WIN = process.platform === "win32";
const HINT = "Install Claude Code and run `claude` once to sign in (or set ORBIT_CLAUDE_BIN to its full path).";

// At most 3 `claude` processes at once across the whole server (chat, agents, briefings); the rest queue.
// Kept on globalThis so dev hot reloads don't create a second, independent limit.
const MAX_CLI = Number(process.env.ORBIT_CLAUDE_CONCURRENCY) || 3;
const gl = globalThis as unknown as { __orbitClaudeLimit?: ReturnType<typeof createLimiter> };
const cliSlot = (gl.__orbitClaudeLimit ??= createLimiter(MAX_CLI));

export type ClaudeResult = { text: string; inputTokens: number; outputTokens: number; ms: number };

/** Shared setup for every CLI call: system prompt in a temp dir, fixed flags, all tools disabled. */
async function prepare(system: string, format: string[]) {
  if (!/^[\w.:-]+$/.test(MODEL)) throw new Error("ORBIT_MODEL contains invalid characters");
  // The system prompt goes in a file and the user prompt on stdin, so no user text is ever on the command line.
  const dir = await mkdtemp(join(tmpdir(), "orbit-"));
  const sysFile = join(dir, "system.txt");
  await writeFile(sysFile, system, "utf8");
  const q = (a: string) => (WIN ? `"${a}"` : a); // Windows needs a shell to run claude.cmd, so quote args there
  const args = ["-p", ...format, "--tools", q(""), "--no-session-persistence",
    // Ignore user-level plugins/hooks/skills and all MCP connectors (CORE must have no tools) but keep the login. Not --bare: it skips OAuth.
    "--setting-sources", "local", "--disable-slash-commands", "--strict-mcp-config", "--model", MODEL, "--system-prompt-file", q(sysFile)];
  const opts = { stdio: ["pipe", "pipe", "pipe"] as ("pipe")[], env: process.env, cwd: dir, windowsHide: true };
  // On Windows, claude may be claude.cmd, which needs a shell; pass one pre-quoted command string (args hold no user text).
  const start = () => (WIN ? spawn(`${q(CLAUDE_BIN)} ${args.join(" ")}`, { ...opts, shell: true }) : spawn(CLAUDE_BIN, args, opts));
  return { dir, start };
}

/** One headless Claude Code call with all tools disabled (it can only read the prompt and answer). */
/** With shell:true on Windows, kill() only ends cmd.exe and leaves claude running: kill the whole tree there. */
function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  if (WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill("SIGKILL"));
  else child.kill("SIGKILL");
}

export function askClaude(prompt: string, system: string): Promise<ClaudeResult> {
  return cliSlot(() => runClaude(prompt, system));
}

async function runClaude(prompt: string, system: string): Promise<ClaudeResult> {
  const t0 = Date.now();
  const { dir, start } = await prepare(system, ["--output-format", "json"]);
  try {
    return await new Promise<ClaudeResult>((resolve, reject) => {
      const child = start();
      let out = "";
      let err = "";
      const timer = setTimeout(() => { killTree(child); reject(new Error("Claude Code timed out after 2 minutes")); }, TIMEOUT_MS);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not start "${CLAUDE_BIN}": ${e.message}. ${HINT}`)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        let j: { result?: string; is_error?: boolean; usage?: { input_tokens?: number; output_tokens?: number } };
        try { j = JSON.parse(out); } catch {
          return reject(new Error(`Claude Code failed: ${(err || out).slice(0, 300) || `exit ${code}`}. ${HINT}`));
        }
        if (j.is_error || code !== 0) return reject(new Error(j.result || err || `claude exited ${code}`));
        resolve({ text: (j.result ?? "").trim(), inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0, ms: Date.now() - t0 });
      });
      child.stdin.on("error", () => { /* EPIPE when the CLI is killed mid-write; the close handler reports it */ });
      child.stdin.end(prompt);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Like askClaude, but calls onDelta with each text chunk as it is generated. Aborting `signal` kills the CLI. */
export function askClaudeStream(prompt: string, system: string, onDelta: (text: string) => void, signal?: AbortSignal): Promise<ClaudeResult> {
  return cliSlot(() => runClaudeStream(prompt, system, onDelta, signal), signal);
}

async function runClaudeStream(prompt: string, system: string, onDelta: (text: string) => void, signal?: AbortSignal): Promise<ClaudeResult> {
  signal?.throwIfAborted();
  const t0 = Date.now();
  const { dir, start } = await prepare(system, ["--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
  try {
    return await new Promise<ClaudeResult>((resolve, reject) => {
      const child = start();
      let buf = "";
      let err = "";
      let streamed = "";
      let result: StreamResult | null = null;
      const onAbort = () => { killTree(child); reject(new DOMException("CORE was stopped", "AbortError")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const timer = setTimeout(() => { killTree(child); reject(new Error("Claude Code timed out after 2 minutes")); }, TIMEOUT_MS);
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
      child.stdin.end(prompt);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Token log only; cost is 0 because the subscription is flat-rate. */
export async function recordUsage(sb: SupabaseClient, userId: string, purpose: string, r: ClaudeResult) {
  const { error } = await sb.from("usage").insert({
    user_id: userId, model: MODEL, purpose, input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: 0,
  });
  if (error) console.error("[orbit] failed to record usage", error);
}

/** Append a universe event. The galaxy animates from these via Supabase Realtime. */
export async function emit(sb: SupabaseClient, userId: string, type: string, planet: string, payload: Record<string, unknown> = {}) {
  const { error } = await sb.from("events").insert({ user_id: userId, type, planet, payload });
  if (error) console.error("[orbit] failed to emit event", type, error);
}
