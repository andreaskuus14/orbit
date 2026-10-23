// CORE latency before/after the core-speed change, with mocked I/O. Run: node --experimental-strip-types scripts/core-latency-bench.ts
// The CLI calls go through the real claude.ts against a fake `claude` (boot delay, then first token after stdin).
// Pre-step latencies are assumptions (edit IO below); the orchestration mirrors runCore's old and new order.
// --real-boot also times the real `claude` CLI from spawn to reading stdin (empty input: it exits before any API call).
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyReflex } from "../src/lib/reflex-pure.ts";

const BOOT = 1000, FIRST_TOKEN = 600; // CLI start-up (measured ~1.0 s on Linux) and model time to first token (assumed)
const IO = { profile: 80, playbook: 80, summaries: 80, memory: 350, chats: 300, facts: 250, modules: 150, world: 200 }; // ms, assumed
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all = (keys: (keyof typeof IO)[]) => Promise.all(keys.map((k) => sleep(IO[k])));

const dir = mkdtempSync(join(tmpdir(), "orbit-bench-"));
const bin = join(dir, "claude.mjs");
writeFileSync(bin, `#!/usr/bin/env node
await new Promise((r) => setTimeout(r, ${BOOT}));
let input = ""; for await (const c of process.stdin) input += c;
await new Promise((r) => setTimeout(r, ${FIRST_TOKEN}));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } } });
out({ type: "result", result: "ok", is_error: false, usage: { input_tokens: 1, output_tokens: 1 } });
`);
chmodSync(bin, 0o755);
process.env.ORBIT_CLAUDE_BIN = bin;
process.env.ORBIT_DATA_DIR = dir;
const { askClaudeStream } = await import("../src/lib/claude.ts");

/** preSpawn: awaited before anything else (runCore reads the profile before the CLI starts). */
async function turn(prep: () => Promise<unknown>, overlap: boolean, preSpawn = () => Promise.resolve<unknown>(0)) {
  const t0 = Date.now();
  await preSpawn();
  let first = 0;
  const prepDone = (async () => { await prep(); return "prompt"; })();
  const prompt = overlap ? prepDone : await prepDone;
  const prepMs = overlap ? "overlapped" : Date.now() - t0;
  await askClaudeStream(prompt, "sys", () => { first ||= Date.now() - t0; }, undefined, "foreground");
  return { prepMs, firstToken: first, total: Date.now() - t0 };
}

const rows: Record<string, unknown> = {};
// Before: memory search alone, then everything else (profile and playbook uncached), then spawn the CLI.
rows["before (serial search, then CLI)"] = await turn(async () => { await all(["memory"]); await all(["profile", "playbook", "summaries", "chats", "facts", "modules", "world"]); }, false);
// After, parallel only: one Promise.all, profile/playbook cached (warm), still spawning after prep.
rows["after: parallel prep only"] = await turn(() => all(["memory", "summaries", "chats", "facts", "modules", "world"]), false);
// After, full: the same prep while the CLI boots.
rows["after: parallel prep + CLI boot overlap"] = await turn(() => all(["memory", "summaries", "chats", "facts", "modules", "world"]), true);
// After, cold caches: profile read before spawn, playbook in the parallel prep.
rows["after: cold caches"] = await turn(() => all(["memory", "playbook", "summaries", "chats", "facts", "modules", "world"]), true, () => all(["profile"]));
// Reflex greet/thanks: no prep at all, the fast model with a tiny prompt (same fake CLI timings; a smaller prompt is not modelled).
rows["after: reflex greet/thanks"] = await turn(() => Promise.resolve(), false);
console.table(rows);

const t = performance.now();
for (let i = 0; i < 10_000; i++) classifyReflex(i % 2 ? "thanks!" : "what did I save about the house plan yesterday?");
console.log(`reflex: classifyReflex ${(((performance.now() - t) / 10_000) * 1000).toFixed(1)} µs per message; time/date answer with no CLI and no prep (~0 ms); greet/thanks skip all prep (fast model only, tiny prompt)`);

if (process.argv.includes("--real-boot")) {
  for (const delay of [0, 800]) {
    const t0 = Date.now();
    const code = await new Promise((r) => {
      const c = spawn(process.env.ORBIT_REAL_CLAUDE_BIN || "claude", ["-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "local", "--disable-slash-commands", "--strict-mcp-config", "--model", "haiku"], { stdio: ["pipe", "ignore", "ignore"], cwd: dir, shell: process.platform === "win32" });
      c.on("close", r);
      setTimeout(() => c.stdin.end(""), delay);
    });
    console.log(`real CLI: stdin after ${delay} ms -> exited after ${Date.now() - t0} ms (code ${code})`);
  }
}
