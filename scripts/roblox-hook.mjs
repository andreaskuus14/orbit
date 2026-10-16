// Claude Code PreToolUse hook for ORBIT's Roblox Studio runs (written per run by src/lib/roblox.ts).
// Usage: node --experimental-strip-types --no-warnings roblox-hook.mjs <state.json>
// Reads the tool call from stdin, judges it with the same guard as the stream check (hookDecide), records accepted calls.
// Exit 2 = block (reason on stderr). Fails closed: any error blocks.
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hookDecide } from "../src/lib/roblox-pure.ts";

const block = (why) => { process.stderr.write(`ORBIT blocked this tool call: ${why}`); process.exit(2); };

try {
  const file = process.argv[2];
  if (!file) block("no state file");
  const call = JSON.parse(readFileSync(0, "utf8"));
  // Parallel tool calls run their hooks at once: a lock file keeps the call history (and so the caps) exact.
  const lock = `${file}.lock`;
  const until = Date.now() + 10_000;
  let fd = -1;
  while (fd < 0) {
    try { fd = openSync(lock, "wx"); } catch {
      if (Date.now() > until) block("timed out waiting for the call history");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  let why = "";
  try { // no process.exit in here: it would skip the finally and leave the lock behind
    const state = JSON.parse(readFileSync(file, "utf8"));
    const c = { name: String(call.tool_name ?? ""), input: call.tool_input && typeof call.tool_input === "object" ? call.tool_input : {} };
    why = hookDecide(state, c) ?? "";
    if (!why) { state.history.push(c); writeFileSync(file, JSON.stringify(state)); }
  } catch (e) { why = e instanceof Error ? e.message : String(e); }
  finally { closeSync(fd); rmSync(lock, { force: true }); }
  if (why) block(why);
} catch (e) { block(e instanceof Error ? e.message : String(e)); }
