#!/usr/bin/env node
// Test double for the Claude Code CLI, used ONLY by the isolated checks (scripts/isolated/README.md): no model, no account, no
// network. ORBIT runs it through ORBIT_CLAUDE_BIN and it answers in Claude Code's stream-json format.
// Markers in the prompt steer it:
//   [slow:N]                  wait N s before answering (Cancel, Stop-all, restart checks)
//   [fail]                    answer with an error
//   [failonce:ID]             fail the first time, behave normally after (Retry check)
//   [propose:create_project]  first agent step proposes that approval tool (interrupted-action checks)
// Every call is logged to FAKE_CLAUDE_LOG ("start" lines carry the prompt's first 80 characters, so checks can count calls per task).
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (m) => { if (logFile) appendFileSync(logFile, `${new Date().toISOString()} ${process.pid} ${m}\n`); };
if (process.argv.includes("--version")) { console.log("2.1.99 (Claude Code) [fake test double]"); process.exit(0); } // Doctor's check
if (process.argv.includes("--help")) { console.log("Usage: claude [options] --effort <level> (fake test double)"); process.exit(0); }

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  let prompt = input; // plain -p text, or one stream-json user message
  try { const c = JSON.parse(input.trim().split("\n")[0])?.message?.content; prompt = typeof c === "string" ? c : (c ?? []).map((b) => b.text ?? "").join("\n"); } catch { /* plain text */ }
  const once = /\[failonce:(\w+)\]/.exec(prompt), mark = `${logFile}.${once?.[1]}`, failedBefore = !!once && existsSync(mark);
  const slow = /\[slow:(\d+)\]/.exec(prompt), first = !/STEP 1:/.test(prompt); // later agent steps answer at once
  log(`start slow=${slow?.[1] ?? 0} first=${first} ${prompt.slice(0, 80).replace(/\n/g, " ")}`);
  if (slow && first && (!once || failedBefore)) await new Promise((r) => setTimeout(r, Number(slow[1]) * 1000));
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init", model: "fake" });
  if (/\[fail\]/.test(prompt) || (once && !failedBefore)) {
    if (once) writeFileSync(mark, "1");
    out({ type: "result", subtype: "error", is_error: true, result: "Simulated model failure (fake CLI)", usage: { input_tokens: 1, output_tokens: 1 } });
    log("fail");
    process.exit(1);
  }
  const text = /\[propose:create_project\]/.test(prompt) && first
    ? JSON.stringify({ thought: "propose", tool: "create_project", input: { name: "Isolation test project", description: "proposed by the fake model" } })
    : JSON.stringify({ thought: "done", final: "Finished (fake model answer)." });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 10, output_tokens: 10 }, num_turns: 1 });
  log("done");
});
