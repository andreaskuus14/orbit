// Strix (AI pentest agents, Apache-2.0, https://github.com/usestrix/strix) against ORBIT's isolated test copy, never the live
// ORBIT. Refuses unless the target is the isolated server on 127.0.0.1:3100 and the isolated stack's markers are present.
// Usage: node --experimental-strip-types scripts/isolated/strix.mjs [--dry-run] [--quick]
// Needs: setup.mjs done, Docker running, `pipx install strix-agent`, STRIX_LLM and LLM_API_KEY in the environment.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { envProblem, summarize, targetProblem } from "../../src/lib/strix-pure.ts";

const L = createRequire(import.meta.url)("./lib.cjs");
const dry = process.argv.includes("--dry-run"), quick = process.argv.includes("--quick");
const die = (m) => { console.error(`strix: ${m}`); process.exit(2); };

const why = targetProblem(L.BASE); if (why) die(why);
let env = null; try { env = L.conf(); } catch { /* reported below */ }
const bad = envProblem(env); if (bad) die(bad);
if (!fs.existsSync(path.join(L.ROOT, ".next-isolated"))) die("no isolated build (.next-isolated): run setup.mjs");

const out = path.join(L.ROOT, "strix-reports"); // gitignored
fs.mkdirSync(out, { recursive: true });
const brief = fs.readFileSync(path.join(L.ROOT, "scripts/isolated/strix/instruction.md"), "utf8")
  + `\n\nTest account: ${env.email} / ${env.password}\n`; // throwaway local account from setup.mjs
const inst = path.join(out, "instruction.md");
fs.writeFileSync(inst, brief);
const args = ["-n", "--target", L.BASE, "--instruction-file", inst, ...(quick ? ["--scan-mode", "quick"] : [])];

if (dry) { console.log("strix: dry run OK. Would run: strix " + args.join(" ")); process.exit(0); }
if (!process.env.STRIX_LLM || !process.env.LLM_API_KEY) die("set STRIX_LLM and LLM_API_KEY (see docs/SECURITY-TESTING.md)");
if (spawnSync("strix", ["--version"], { stdio: "ignore" }).error) die("strix is not installed: pipx install strix-agent");

L.stop(); L.start();
if (!await L.up()) die("the isolated server didn't start (see server.log)");
try {
  // the isolated server gets only test values (serverEnv); Strix gets this shell's env for its own LLM key
  const r = spawnSync("strix", args, { cwd: out, stdio: "inherit", env: process.env });
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(md|json|txt)$/.test(f.name)) files.push(p); } };
  if (fs.existsSync(path.join(out, "strix_runs"))) walk(path.join(out, "strix_runs"));
  const s = summarize(files.map((f) => fs.readFileSync(f, "utf8")));
  console.log(`\nstrix: exit ${r.status}. Findings: critical ${s.critical}, high ${s.high}, medium ${s.medium}, low ${s.low}, info ${s.info}.`);
  for (const t of s.titles) console.log(`  - ${t}`);
  console.log(`Reports: ${path.join(out, "strix_runs")}`);
} finally { L.stop(); }
