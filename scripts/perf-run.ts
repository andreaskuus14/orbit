// Prints scripted perf runs (roadmap 1.2) from <ORBIT data dir>/perf-runs, each compared with the previous run at the
// same visible viewport, GPU and render settings (p95 more than 15% slower = REGRESSION). Used by scripts/perf-run.ps1 (npm run perf:run).
//   node --experimental-strip-types scripts/perf-run.ts                         latest run per window size
//   node --experimental-strip-types scripts/perf-run.ts --wait 1536x864 --since <epoch ms> [--timeout 240]
// Exit code: 0 ok, 2 a regression, 3 no run arrived in time.
import { listRuns, perfRunDir } from "../src/lib/perf-runs.ts";
import { compareRuns, formatRun, previousOf, type PerfRun } from "../src/lib/perf-run-pure.ts";

try { process.loadEnvFile(".env.local"); } catch { /* no .env.local: default data dir */ } // ORBIT_DATA_DIR may live there
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const label = arg("--wait"), since = Number(arg("--since") ?? 0), timeout = Number(arg("--timeout") ?? 240) * 1000;

const show = (runs: PerfRun[], r: PerfRun) => { const rows = compareRuns(previousOf(runs, r), r); console.log(formatRun(r, rows) + "\n"); return rows.some((x) => x.regressed); };

let runs = await listRuns(200);
let picked: PerfRun[];
if (label) {
  const end = Date.now() + timeout;
  const find = () => runs.find((r) => r.label === label && r.at > since);
  while (!find() && Date.now() < end) { await new Promise((ok) => setTimeout(ok, 2000)); runs = await listRuns(200); }
  if (!find()) { console.error(`No perf run "${label}" arrived in ${timeout / 1000} s (looking in ${perfRunDir()}). Is ORBIT signed in in this Chrome profile?`); process.exit(3); }
  picked = [find()!];
} else {
  picked = [...new Map(runs.map((r) => [r.label, r])).values()];
  if (!picked.length) console.log(`No perf runs yet in ${perfRunDir()}. Run npm run perf:run.`);
}
const bad = picked.map((r) => show(runs, r)).some(Boolean);
process.exit(bad ? 2 : 0);
