import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/clips/shorts-plan.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function load(allowed = true) {
  const approved: string[] = [];
  const batch = { items: [{ id: "s1", title: "One", credits: 10 }], credits: 10 };
  const m = { exports: {} as any };
  const g: Record<string, unknown> = { module: m, exports: m.exports, console, setTimeout,
    require: (name: string) => {
      if (name === "node:path") return { default: path };
      if (name.endsWith("/factory")) return { listJobs: async () => [], readState: async () => null, saveState: async () => {}, studioRoot: () => "/x" };
      if (name.endsWith("/story")) return { listStories: async () => [], getStory: async (id: string) => ({ id }), runningStory: () => null, weekUsage: async () => ({ used: 0, cap: 100 }),
        approveStory: async (j: { id: string }) => { approved.push(j.id); return {}; }, quoteStory: async () => ({}), writeStory: async () => ({}) };
      if (name.endsWith("/story-pure")) return { DRAMA_DEFAULT: "d", approveProblem: () => "", fingerprint: () => "", payable: () => [], quoteTotal: () => 0, validStoryOpts: () => ({}) };
      if (name.endsWith("higgsfield-pure")) return { capProblem: () => "", weekStart: () => 0 };
      if (name.endsWith("pipeline-pure")) return { validTarget: () => 1, weekProgress: () => ({}) };
      if (name.endsWith("/stop-all")) return { stopAllOn: () => false };
      if (name.endsWith("stop-all-pure")) return { PAUSED_MSG: "paused" };
      if (name.endsWith("shorts-plan-pure")) return { batchProblem: () => "", emptyPlan: () => ({ picks: [] }), rollWeek: (p: object) => p, morningBatch: () => batch, inFlight: () => 0, weekNeed: () => 0, ideaCands: () => [], trendCands: () => [], nightTodo: () => ({}), pickIdeas: () => [], planProblem: () => "" };
      if (name.endsWith("/autonomy")) return { allows: () => (allowed ? { ok: true } : { ok: false, why: "Off" }) };
      throw new Error(name);
    },
  };
  runInNewContext(code, g); // the sandbox is the module's globalThis
  return { m, g, approved };
}

test("approveBatch: two simultaneous clicks start one run (claimed before any await)", async () => {
  const { m, g, approved } = load();
  const [a, b] = await Promise.all([m.exports.approveBatch(["s1"], 10), m.exports.approveBatch(["s1"], 10)]);
  assert.equal(typeof a, "object");
  assert.equal(b, "A batch is already being made");
  while (g.__orbitShortsBatch) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(approved, ["s1"]);
});

test("approveBatch: a refusal releases the claim", async () => {
  const { m, g } = load(false);
  assert.equal(await m.exports.approveBatch(["s1"], 10), "Off");
  assert.equal(g.__orbitShortsBatch, undefined);
});
