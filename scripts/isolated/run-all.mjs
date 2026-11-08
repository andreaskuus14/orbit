// Isolated checks, step 2: start the test server and run every check against it. Exit code 1 if any check failed.
// `node scripts/isolated/run-all.mjs basic pair` runs only those (basic, restart, pair, coldstart, briefing, studio, core).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const L = createRequire(import.meta.url)("./lib.cjs");
if (!existsSync(path.join(L.DIR, "env.json"))) { console.error("run-all: run scripts/isolated/setup.mjs first"); process.exit(1); }
const all = ["basic", "restart", "pair", "coldstart", "briefing", "studio", "core", "phone"];
const pick = process.argv.slice(2).length ? process.argv.slice(2) : all;
const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: L.ROOT, encoding: "utf8" }).stdout.trim();
console.log(`isolated checks on ${commit} (built into .next-isolated by setup.mjs; rebuild after changing code)`);
await L.restart();
const results = [];
for (const name of pick) {
  console.log(`\n## ${name}`);
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, `check-${name}.cjs`)], { stdio: "inherit" });
  results.push([name, r.status === 0]);
}
L.stop();
console.log(`\n${results.map(([n, ok]) => `${ok ? "PASS" : "FAIL"} ${n}`).join("\n")}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
