// npm run eval:agents -- [--json] [--results runs.json]
// Offline: before (evals/agent-baseline.ts) vs after (agent-defs-pure.ts) readiness per agent, plus acceptance checks on recorded
// answers when --results is given. Never calls a model. Exit 1 when an agent's readiness dropped or a recorded answer failed.
import { readFileSync } from "node:fs";
import { AGENT_SUITE } from "../evals/agent-suite.ts";
import { BASELINE_AGENTS } from "../evals/agent-baseline.ts";
import { BUILTIN_AGENTS } from "../src/lib/agent-defs-pure.ts";
import { scoreDefs, scoreRuns, validateSuite } from "../src/lib/agent-eval-pure.ts";

const args = process.argv.slice(2), json = args.includes("--json"), ri = args.indexOf("--results");
try {
  validateSuite(AGENT_SUITE, BUILTIN_AGENTS.map((a) => a.slug));
  const before = scoreDefs(BASELINE_AGENTS, AGENT_SUITE), after = scoreDefs(BUILTIN_AGENTS, AGENT_SUITE);
  const runs = ri >= 0 ? scoreRuns(BUILTIN_AGENTS, AGENT_SUITE, JSON.parse(readFileSync(args[ri + 1], "utf8"))) : null;
  const rows = after.map((a) => ({ ...a, before: before.find((b) => b.agent === a.agent)! }));
  if (json) console.log(JSON.stringify({ kind: "offline definition readiness + recorded-answer checks; not a live model benchmark", rows, runs }, null, 2));
  else {
    console.log("agent     tasks  before  after  judge*  still missing");
    for (const r of rows) console.log(`${r.agent.padEnd(9)} ${String(r.tasks).padStart(5)}  ${`${r.before.pct}%`.padStart(6)}  ${`${r.pct}%`.padStart(5)}  ${String(r.judged).padStart(6)}  ${r.missing.join("; ") || "-"}`);
    console.log("* judge = model-graded rubric items, scored only from recorded runs via npm run eval:ai.");
    if (runs) {
      for (const r of runs.runs.filter((x) => !x.ok)) console.log(`FAIL ${r.id}: ${r.fails.join("; ")}`);
      console.log(`Recorded answers: ${runs.runs.filter((r) => r.ok).length}/${runs.runs.length} passed; ${runs.pending.length} pending (no run).`);
    } else console.log(`Answer checks: ${AGENT_SUITE.length} tasks pending a live run (pass --results runs.json).`);
  }
  if (rows.some((r) => r.pct < r.before.pct) || runs?.runs.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
