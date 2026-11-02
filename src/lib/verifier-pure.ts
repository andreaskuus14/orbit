// Independent verifier: after a CORE turn whose receipt says "verified" for a checkable task (site build, countable ask, workspace
// files, leads), a fresh `claude -p` with NO tools gets the request, the receipt and the evidence (the files as written, the site
// check line, the created records) and is told to prove the task is NOT done. Agents praise their own work; a refuter doesn't.
// Pure parts here (when to run, the prompt, verdict parsing); the call is verifier.ts. Tests: tests/verifier-pure.test.ts.
import { acceptanceOf, type Receipt } from "./receipt-pure.ts";
import type { CoreEvalTool } from "./core-answer-eval-pure.ts";

export type Verdict = { ok: boolean; reason: string };
const CHECKABLE = new Set(["ws_write", "lead_create"]);
const ok = (t: CoreEvalTool) => !t.output.startsWith("Error:");

/** Only when the receipt claims done and there is something a reader can check; never for plain chat or reads. */
export function needsVerify(question: string, receipt: Receipt | null | undefined, tools: readonly CoreEvalTool[]): boolean {
  if (receipt?.status !== "verified") return false;
  return acceptanceOf(question).kind !== "writes" || tools.some((t) => CHECKABLE.has(t.tool) && ok(t));
}

export const VERIFIER_SYSTEM = `You are ORBIT's independent verifier. Another agent says it finished the user's request. Your job is to prove it is NOT done.
You only read: the request, the agent's receipt and answer, and the evidence below (files exactly as written, the headless site check, records created). You have no tools.
Look for concrete gaps that break the request: a count short of what was asked, files missing or referenced but not written, placeholder or lorem text, broken links between the files, a site check that lists problems, records that don't match the ask (wrong kind, duplicates, missing required detail), an answer claiming something the evidence doesn't show.
Ignore style, taste and nice-to-haves; flag only what makes the stated request unmet. If you can't find such a gap, it is verified.
Reply with exactly one line and nothing else:
VERDICT: verified — <one short reason>
or
VERDICT: not verified — <the concrete gap, one short line the agent can act on>`;

const MAX = 24_000;
/** The verifier's prompt: request, receipt, answer, then evidence (last write of each file wins), capped. */
export function verifierPrompt(question: string, receipt: Receipt, answer: string, tools: readonly CoreEvalTool[], cap = MAX): string {
  const files = new Map<string, string>(), other: string[] = [];
  for (const t of tools.filter(ok)) {
    if (t.tool === "ws_write" && Array.isArray(t.input.files)) {
      for (const f of t.input.files as { path?: unknown; content?: unknown }[]) if (typeof f?.path === "string") files.set(`${String(t.input.workspace ?? "")}/${f.path}`, typeof f.content === "string" ? f.content : "");
      const at = t.output.lastIndexOf("\nCheck: ");
      if (at >= 0) other.push(`ws_write site check: ${t.output.slice(at + 1, at + 801)}`);
    } else if (t.tool === "lead_create" || t.tool === "save_memory" || t.tool === "create_goal" || t.tool.startsWith("goal_")) other.push(`${t.tool} result: ${t.output.slice(0, 1500)}`);
  }
  const head = `REQUEST:\n${question.slice(0, 2000)}\n\nRECEIPT (the agent's own check): ${receipt.accept}\nverified: ${receipt.verified.join("; ") || "-"}\nnot checked: ${receipt.claimed.join("; ") || "-"}\n\nAGENT'S ANSWER:\n${answer.slice(0, 3000)}\n\n`;
  let ev = other.length ? `RECORDS AND CHECKS:\n${other.join("\n")}\n\n` : "";
  for (const [p, c] of files) {
    const left = cap - head.length - ev.length;
    if (left < 200) { ev += `(more files not shown: the evidence was cut at ${cap} characters)\n`; break; }
    const body = c.length > left - 100 ? `${c.slice(0, left - 100)}\n…(cut)` : c;
    ev += `FILE ${p} (${c.length} chars):\n${body}\n\n`;
  }
  return `${head}${ev}Prove it is NOT done, or say it is verified. One VERDICT line.`;
}

/** The verifier's reply → a verdict; null when it didn't answer in the format (then the receipt keeps no verifier line). */
export function parseVerdict(text: string): Verdict | null {
  const m = /VERDICT\s*:\s*\**\s*(not\s+verified|unverified|verified)\b\**\s*[-—–:]*\s*(.*)/i.exec(text);
  if (!m) return null;
  const reason = m[2].replace(/\s+/g, " ").trim().slice(0, 200);
  return { ok: m[1].toLowerCase() === "verified", reason: reason || (m[1].toLowerCase() === "verified" ? "no gap found" : "no reason given") };
}

/** The done-gate's extra continue after a failed check (MCP engine, once per turn). */
export const verifierContinue = (v: Verdict) =>
  `ORBIT independent check: the request is NOT met yet: ${v.reason}. Fix exactly that with your tools, check it, then answer. If it truly can't be done, say plainly what is missing.`;
