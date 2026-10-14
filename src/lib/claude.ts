import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// CORE runs on the local Claude Code CLI (`claude -p`) under your own Claude login, so there is no API key
// and no per-token bill. ORBIT must therefore run on the machine where `claude` is installed and signed in.
export const CLAUDE_BIN = process.env.ORBIT_CLAUDE_BIN || "claude";
export const MODEL = process.env.ORBIT_MODEL || "sonnet";
const TIMEOUT_MS = 120_000;
const WIN = process.platform === "win32";
const HINT = "Install Claude Code and run `claude` once to sign in (or set ORBIT_CLAUDE_BIN to its full path).";

export type ClaudeResult = { text: string; inputTokens: number; outputTokens: number; ms: number };

/** One headless Claude Code call with all tools disabled (it can only read the prompt and answer). */
export async function askClaude(prompt: string, system: string): Promise<ClaudeResult> {
  if (!/^[\w.:-]+$/.test(MODEL)) throw new Error("ORBIT_MODEL contains invalid characters");
  const t0 = Date.now();
  // The system prompt goes in a file and the user prompt on stdin, so no user text is ever on the command line.
  const dir = await mkdtemp(join(tmpdir(), "orbit-"));
  const sysFile = join(dir, "system.txt");
  await writeFile(sysFile, system, "utf8");
  const q = (a: string) => (WIN ? `"${a}"` : a); // Windows needs a shell to run claude.cmd, so quote args there
  const args = ["-p", "--output-format", "json", "--tools", q(""), "--no-session-persistence",
    // Ignore user-level plugins/hooks/skills and all MCP connectors (CORE must have no tools) but keep the login. Not --bare: it skips OAuth.
    "--setting-sources", "local", "--disable-slash-commands", "--strict-mcp-config", "--model", MODEL, "--system-prompt-file", q(sysFile)];

  try {
    return await new Promise<ClaudeResult>((resolve, reject) => {
      const opts = { stdio: ["pipe", "pipe", "pipe"] as ("pipe")[], env: process.env, cwd: dir, windowsHide: true };
      // On Windows, claude may be claude.cmd, which needs a shell; pass one pre-quoted command string (args hold no user text).
      const child = WIN ? spawn(`${q(CLAUDE_BIN)} ${args.join(" ")}`, { ...opts, shell: true }) : spawn(CLAUDE_BIN, args, opts);
      let out = "";
      let err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Claude Code timed out after 2 minutes")); }, TIMEOUT_MS);
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
