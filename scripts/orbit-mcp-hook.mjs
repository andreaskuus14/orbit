// PreToolUse hook for CORE's MCP engine (core-mcp-boost.ts): `node scripts/orbit-mcp-hook.mjs <bridge.json>`.
// Sends Claude Code's hook input to the turn's bridge (/pre), which answers allow ({}) or deny (folder escape, taint, .env, config).
// Fails closed: if the bridge can't answer, the built-in call is denied.
import { readFileSync } from "node:fs";

const deny = (why) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `ORBIT: ${why}` } });
let input = "";
for await (const c of process.stdin) input += c;
try {
  const bridge = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const r = await fetch(bridge.url + "/pre", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bridge.token}` }, body: input || "{}" });
  process.stdout.write(r.ok ? JSON.stringify(await r.json()) : deny(`bridge answered ${r.status}`));
} catch (e) {
  process.stdout.write(deny(`check unavailable (${e instanceof Error ? e.message : String(e)})`));
}
