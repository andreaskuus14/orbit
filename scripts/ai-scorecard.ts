import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RETRIEVAL_CASES } from "../evals/memory-cases.ts";
import { AGENT_CASES } from "../evals/agent-cases.ts";
import { selectCoreMemoryIds } from "../src/lib/memory-retrieval-pure.ts";
import { rrfMerge } from "../src/lib/pure.ts";
import { legacyMemoryIds } from "../evals/legacy-memory-pure.ts";
import { scoreAgentRuns } from "../src/lib/agent-scorecard-pure.ts";

const args = process.argv.slice(2);
const json = args.includes("--json"), complete = args.includes("--require-complete");
const resultIndex = args.indexOf("--results");
const unknown = args.filter((a, i) => !["--json", "--require-complete", "--results"].includes(a) && !(resultIndex >= 0 && i === resultIndex + 1));
if (unknown.length || args.filter((a) => a === "--results").length > 1 || (resultIndex >= 0 && (!args[resultIndex + 1] || args[resultIndex + 1].startsWith("--")))) {
  console.error("Usage: npm run eval:ai -- [--json] [--results runs.json] [--require-complete]");
  process.exit(1);
}
try {
  const start = performance.now();
  const retrieval = RETRIEVAL_CASES.map((c) => {
    const baseline = legacyMemoryIds(c.fts, c.semantic);
    const primary = rrfMerge([c.fts, c.semantic]).map((r) => r.id);
    const ranked = selectCoreMemoryIds(primary, c.context ?? [], c.query, 8, c.project);
    const metrics = (ids: string[]) => {
      if (!c.relevant.length) return { top1: ids.length === 0, recallAt3: ids.length ? 0 : 1, recallAt8: ids.length ? 0 : 1, reciprocalRank: ids.length ? 0 : 1 };
      const first = ids.findIndex((id) => c.relevant.includes(id));
      return { top1: c.relevant.includes(ids[0]), recallAt3: c.relevant.filter((id) => ids.slice(0, 3).includes(id)).length / c.relevant.length, recallAt8: c.relevant.filter((id) => ids.slice(0, 8).includes(id)).length / c.relevant.length, reciprocalRank: first < 0 ? 0 : 1 / (first + 1) };
    };
    return { id: c.id, baselineIds: baseline, upgradedIds: ranked, baseline: metrics(baseline), upgraded: metrics(ranked) };
  });
  const mean = (key: "baseline" | "upgraded", metric: "recallAt3" | "recallAt8" | "reciprocalRank") => retrieval.reduce((n, r) => n + r[key][metric], 0) / retrieval.length;
  const recorded = resultIndex >= 0 ? JSON.parse(readFileSync(args[resultIndex + 1], "utf8")) : [];
  const agent = scoreAgentRuns(AGENT_CASES, recorded);
  const report = {
    retrieval: {
      kind: "synthetic candidate-ranking fixtures, not a live AI benchmark", total: retrieval.length,
      baselineTop1: retrieval.filter((r) => r.baseline.top1).length, upgradedTop1: retrieval.filter((r) => r.upgraded.top1).length,
      baselineRecallAt3: mean("baseline", "recallAt3"), upgradedRecallAt3: mean("upgraded", "recallAt3"),
      baselineRecallAt8: mean("baseline", "recallAt8"), upgradedRecallAt8: mean("upgraded", "recallAt8"),
      baselineMRR: mean("baseline", "reciprocalRank"), upgradedMRR: mean("upgraded", "reciprocalRank"),
      fixtureRankingMs: performance.now() - start, cases: retrieval,
    },
    agent,
  };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Retrieval fixtures: top-1 ${report.retrieval.baselineTop1}/${retrieval.length} baseline -> ${report.retrieval.upgradedTop1}/${retrieval.length} upgraded`);
    console.log(`Recall@3: ${report.retrieval.baselineRecallAt3.toFixed(3)} -> ${report.retrieval.upgradedRecallAt3.toFixed(3)}; MRR: ${report.retrieval.baselineMRR.toFixed(3)} -> ${report.retrieval.upgradedMRR.toFixed(3)}`);
    console.log(`Recorded agent runs: ${agent.recorded}/${agent.total}; passed ${agent.passed}; pending ${agent.pending.length}.`);
    console.log(`Recall@8: ${report.retrieval.baselineRecallAt8.toFixed(3)} -> ${report.retrieval.upgradedRecallAt8.toFixed(3)}. Baseline is frozen pre-PR fusion over identical raw channel lists.`);
    console.log("Synthetic ranking scores do not measure live answer quality or actual database/embedding retrieval. Unsolved cases remain in the report. See docs/AI-SCORECARD.md.");
  }
  const regression = retrieval.some((r) => r.upgraded.recallAt8 < r.baseline.recallAt8 || r.upgraded.reciprocalRank < r.baseline.reciprocalRank);
  if (regression || agent.runs.some((r) => !r.passed) || (complete && agent.pending.length > 0)) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
