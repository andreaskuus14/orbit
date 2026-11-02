// npm run eval -- [--engine json|mcp|sdk] [--set regression|capability] [--only <id>] [--trials 3] [--json] [--out runs.json]
// Golden CORE tasks (evals/tasks/*.json) against the RUNNING ORBIT server, graded by code (src/lib/eval-core-pure.ts).
// Needs: ORBIT running (npm run app:start), ORBIT_EVAL_COOKIE = the Cookie header of a signed-in ORBIT tab (DevTools → Network →
// any /api request → Request Headers → cookie), optional ORBIT_EVAL_BASE (default http://127.0.0.1:3000). Without them it skips (exit 0),
// so CI and tests never need the live CLI. It uses the real CORE path: tasks write real records (leads, workspaces, memories, goals)
// into ORBIT and each one starts a new chat; delete them afterwards if you want. Exit 1 when a regression task fails.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeRun, summarize, validateTask, type EvalTask } from "../src/lib/eval-core-pure.ts";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (process.env.ORBIT_EVAL_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const COOKIE = process.env.ORBIT_EVAL_COOKIE ?? "";
const trials = Math.max(1, Math.min(5, Number(opt("trials")) || 1));
const headers = { "content-type": "application/json", cookie: COOKIE, origin: BASE };
const api = (path: string, body?: unknown, ms = 15_000) => fetch(BASE + path, { method: body === undefined ? "GET" : "POST", headers, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(ms) });

const dir = join(import.meta.dirname, "..", "evals", "tasks");
const tasks: EvalTask[] = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const t = validateTask(JSON.parse(readFileSync(join(dir, f), "utf8")));
  if (typeof t === "string") throw new Error(`${f}: ${t}`);
  return t;
}).filter((t) => (!opt("set") || t.set === opt("set")) && (!opt("only") || t.id === opt("only")));

async function main() {
  if (!COOKIE) return console.log("eval: skipped (set ORBIT_EVAL_COOKIE to a signed-in ORBIT tab's Cookie header; see scripts/eval-core.ts)");
  const was = await api("/api/core/engine").then((r) => (r.ok ? r.json() : null), () => null) as { engine: string; fallback: string } | null;
  if (!was) return console.log(`eval: skipped (ORBIT at ${BASE} is not reachable or the cookie is not signed in)`);
  const engine = opt("engine");
  if (engine) { const r = await api("/api/core/engine", { engine }); if (!r.ok) throw new Error(`could not switch engine: ${(await r.json().catch(() => ({}))).error ?? r.status}`); }
  const active = engine ?? was.engine;
  console.log(`eval: ${tasks.length} tasks × ${trials} on engine ${active === "cli" ? "json" : active} at ${BASE}`);
  const rows: { id: string; set: string; trial: number; ok: boolean; fails: string[]; ms: number; answer: string }[] = [];
  try {
    for (const t of tasks) for (let k = 1; k <= trials; k++) {
      const t0 = Date.now();
      const r = await api("/api/core", { message: t.input, requestId: `eval-${t.id}-${k}-${t0}` }, 330_000).catch((e) => e as Error);
      const j = r instanceof Error ? { error: r.message } : await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      const g = j.error ? { ok: false, fails: [`turn failed: ${String(j.error).slice(0, 160)}`] } : gradeRun(t, { answer: String(j.answer ?? ""), trace: Array.isArray(j.trace) ? j.trace : [] });
      rows.push({ id: t.id, set: t.set, trial: k, ...g, ms: Date.now() - t0, answer: String(j.answer ?? "").slice(0, 2000) });
      if (!args.includes("--json")) console.log(`${g.ok ? "PASS" : "FAIL"} ${t.id} #${k} ${((Date.now() - t0) / 1000).toFixed(0)}s${g.fails.length ? `: ${g.fails.join("; ")}` : ""}`);
    }
  } finally {
    if (engine) await api("/api/core/engine", { engine: was.engine === was.fallback ? null : was.engine }).catch(() => {}); // put his choice back
  }
  const sum = summarize(rows);
  if (opt("out")) writeFileSync(opt("out")!, JSON.stringify({ engine: active, at: new Date().toISOString(), rows, sum }, null, 2));
  if (args.includes("--json")) console.log(JSON.stringify({ engine: active, sum, rows }, null, 2));
  else for (const set of ["regression", "capability"]) {
    const s = sum.filter((x) => x.set === set);
    if (s.length) console.log(`${set}: pass@1 ${Math.round((100 * s.reduce((a, x) => a + x.pass1, 0)) / s.length)}% · pass^${trials} ${s.filter((x) => x.passK).length}/${s.length}`);
  }
  if (rows.some((r) => r.set === "regression" && !r.ok)) process.exitCode = 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
