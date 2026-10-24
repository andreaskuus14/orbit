// Claude Code PreToolUse hook for ORBIT's Higgsfield calls (src/lib/clips/higgsfield.ts):
//   node --experimental-strip-types scripts/hf-guard.ts <policy.json>
// Reads the hook event on stdin; exit 0 allows the tool call, exit 2 blocks it (stderr goes back to Claude). Fails closed.
import { readFileSync, writeFileSync } from "node:fs";
import { guardDecision, type GuardPolicy } from "../src/lib/clips/story-pure.ts";

try {
  const policyFile = process.argv[2];
  const policy = JSON.parse(readFileSync(policyFile, "utf8")) as GuardPolicy;
  const usedFile = `${policyFile}.used`;
  let used: number[] = [];
  try { used = JSON.parse(readFileSync(usedFile, "utf8")); } catch { /* first call */ }
  const ev = JSON.parse(readFileSync(0, "utf8")) as { tool_name?: string; tool_input?: unknown };
  const d = guardDecision(policy, used, String(ev.tool_name ?? ""), ev.tool_input);
  if (!d.allow) { process.stderr.write(d.reason); process.exit(2); }
  if (d.use !== undefined) writeFileSync(usedFile, JSON.stringify([...used, d.use]));
  process.exit(0);
} catch (e) {
  process.stderr.write(`ORBIT guard failed, call blocked: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}
