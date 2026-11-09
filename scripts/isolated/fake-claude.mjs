#!/usr/bin/env node
// Test double for the Claude Code CLI, used ONLY by the isolated checks (scripts/isolated/README.md): no model, no account, no
// network. ORBIT runs it through ORBIT_CLAUDE_BIN and it answers in Claude Code's stream-json format.
// Markers in the prompt steer it:
//   [slow:N]                  wait N s before answering (Cancel, Stop-all, restart checks)
//   [slowfor:N:ID]            hang on every call during the first N s after the first one, then answer at once (a CORE turn
//                             that outlasts its time limit, hands off, and finishes in the background)
//   [fail]                    answer with an error
//   [failonce:ID]             fail the first time, behave normally after (Retry check)
//   [propose:create_project]  first agent step proposes that approval tool (interrupted-action checks)
// A Pulse briefing prompt ("NEWS EVENTS") gets a short briefing citing its first article ([a:<id>]), as Pulse requires.
// Every call is logged to FAKE_CLAUDE_LOG ("start" lines carry the prompt's first 80 characters, so checks can count calls per task).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (m) => { if (logFile) appendFileSync(logFile, `${new Date().toISOString()} ${process.pid} ${m}\n`); };
if (process.argv.includes("--version")) { console.log("2.1.99 (Claude Code) [fake test double]"); process.exit(0); } // Doctor's check
if (process.argv.includes("--help")) { console.log("Usage: claude [options] --effort <level> (fake test double)"); process.exit(0); }

/** A valid AI Story package for the target length: 5 scenes whose seconds add up to it, narration that fits ~2.5 words/s. */
const fakeStory = (len) => {
  const lines = ["The lighthouse went dark at midnight.", "Mara climbed the stairs with a lantern.", "Someone had written on the glass.",
    "It was her own handwriting, dated tomorrow.", "She lit the lamp anyway, and the ship turned home."];
  const sec = Math.max(3, Math.floor(len / lines.length));
  return { title: "The Lighthouse Note", hook: "Dated tomorrow", scenes: lines.map((narration, i) => ({
    visual: `Moody painted lighthouse at night, keeper Mara in a yellow raincoat, scene ${i + 1}, vertical composition`, narration,
    sec: i === lines.length - 1 ? len - sec * (lines.length - 1) : sec, camera: ["slow push in", "tilt up", "pan left", "pull out", "slow push in"][i] })) };
};

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
  const slowFor = /\[slowfor:(\d+):(\w+)\]/.exec(prompt), firstMark = `${logFile}.slowfor.${slowFor?.[2]}`;
  if (slowFor) {
    if (!existsSync(firstMark)) writeFileSync(firstMark, String(Date.now()));
    const left = Number(readFileSync(firstMark, "utf8")) + Number(slowFor[1]) * 1000 - Date.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left + 600_000)); // past the window: ORBIT's call timeout ends this call
  }
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init", model: "fake" });
  if (/\[fail\]/.test(prompt) || (once && !failedBefore)) {
    if (once) writeFileSync(mark, "1");
    out({ type: "result", subtype: "error", is_error: true, result: "Simulated model failure (fake CLI)", usage: { input_tokens: 1, output_tokens: 1 } });
    log("fail");
    process.exit(1);
  }
  const article = /NEWS EVENTS/.test(prompt) && /\[a:([0-9a-f-]{36})\]/i.exec(prompt);
  const story = /Target length: (\d+) seconds/.exec(prompt); // AI Story's script request (story.ts writeStory)
  const text = story ? JSON.stringify(fakeStory(Number(story[1])))
    : article ? `## Today\n\nThe top story of the day, in one line [a:${article[1]}].`
    : /\[propose:create_project\]/.test(prompt) && first
    ? JSON.stringify({ thought: "propose", tool: "create_project", input: { name: "Isolation test project", description: "proposed by the fake model" } })
    : JSON.stringify({ thought: "done", final: "Finished (fake model answer)." });
  out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  out({ type: "result", subtype: "success", is_error: false, result: text, usage: { input_tokens: 10, output_tokens: 10 }, num_turns: 1 });
  log("done");
});
