// Phase 2 (#5): Deterministic Silent Verify-Before-Reply for CORE builder turns (pure, zero I/O).
// Inspects real artifacts written/executed during a turn (Roblox Luau scripts, workspace HTML, code sandbox runs)
// and returns concrete fix instructions if a deterministic bug/exploit is found — enabling 1 silent fix pass before replying.
import type { CoreEvalTool } from "./core-answer-eval-pure.ts";
import { auditRemotes } from "./playtesters-pure.ts";

export type VerifyIssue = {
  kind: "roblox_exploit" | "html_broken" | "sandbox_failed";
  target: string;
  detail: string;
};

export type TurnVerifyResult = {
  ok: boolean;
  issues: VerifyIssue[];
  fixPrompt: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Deterministically inspect outputs produced by a CORE turn before returning "final".
 * Never makes network/LLM calls and never blocks ordinary chat turns (returns ok: true when no build artifacts were written).
 */
export function verifyTurnOutputs(tools: readonly CoreEvalTool[], answer: string): TurnVerifyResult {
  const issues: VerifyIssue[] = [];

  // 1. Collect latest written/edited files per path so a fixed rewrite supersedes an earlier buggy write.
  const latestFiles = new Map<string, string>();
  for (const t of tools) {
    if (t.output.startsWith("Error:")) continue;
    if (t.tool === "ws_write" || t.tool === "ws_edit") {
      const p = str(t.input.path) || str(t.input.file);
      const content = str(t.input.content) || str(t.input.text);
      if (p && content) latestFiles.set(p, content);
    }
  }

  // 1a. Roblox Luau exploit audit (5/5 server exploit classes via auditRemotes)
  const luauFiles: { file: string; text: string }[] = [];
  for (const [file, text] of latestFiles) {
    if (/\.luau?$/i.test(file)) luauFiles.push({ file, text });
  }
  if (luauFiles.length) {
    const high = auditRemotes(luauFiles).filter((f) => f.severity === "high");
    for (const f of high.slice(0, 3)) {
      issues.push({
        kind: "roblox_exploit",
        target: f.file,
        detail: `${f.remote || "RemoteEvent"} (line ${f.line}): ${f.why}`,
      });
    }
  }

  // 1b. Workspace HTML sanity check (empty or truncated HTML / unclosed script tag)
  for (const [file, text] of latestFiles) {
    if (!/\.html?$/i.test(file)) continue;
    const trimmed = text.trim();
    if (trimmed.length < 40) {
      issues.push({ kind: "html_broken", target: file, detail: "HTML file is nearly empty (<40 chars)." });
      continue;
    }
    const openScripts = (trimmed.match(/<script\b[^>]*>/gi) ?? []).length;
    const closeScripts = (trimmed.match(/<\/script>/gi) ?? []).length;
    if (openScripts > closeScripts) {
      issues.push({ kind: "html_broken", target: file, detail: `Unclosed <script> tag (${openScripts} opened, ${closeScripts} closed).` });
    }
    if (/<html\b/i.test(trimmed) && !/<\/html>/i.test(trimmed)) {
      issues.push({ kind: "html_broken", target: file, detail: "Missing closing </html> tag (output may be truncated)." });
    }
  }

  // 2. Code sandbox failure check: if the latest sandbox run failed but the final answer doesn't mention any error/failure
  const sandboxRuns = tools.filter((t) => t.tool === "run_code" || t.tool === "code_sandbox");
  const lastSandbox = sandboxRuns.at(-1);
  if (lastSandbox && (lastSandbox.output.startsWith("Error:") || /\bexit(?:ed)?\s*(?:code\s*)?[=:]?\s*[1-9]\d*/i.test(lastSandbox.output))) {
    const mentionsError = /\b(error|failed|exception|traceback|exit\s*[1-9]|couldn'?t\s+run|broken)\b/i.test(answer);
    if (!mentionsError) {
      issues.push({
        kind: "sandbox_failed",
        target: lastSandbox.tool,
        detail: lastSandbox.output.replace(/\s+/g, " ").trim().slice(0, 180),
      });
    }
  }

  if (!issues.length) return { ok: true, issues: [], fixPrompt: "" };

  const lines = issues.map((x, i) => `${i + 1}. [${x.kind}] ${x.target}: ${x.detail}`);
  const fixPrompt = [
    "SILENT VERIFY-BEFORE-REPLY caught real issue(s) in your generated output:",
    ...lines,
    "Fix ONLY these concrete issue(s) now (using your tools if needed) and verify cleanly before giving your final answer. Do not mention this internal check unless an issue remains unfixable.",
  ].join("\n");

  return { ok: false, issues, fixPrompt };
}
