import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as replayPure from "../src/lib/agent-replay-pure.ts";
import { REPLAY_CASES } from "../evals/agent-replay-cases.ts";
import { BUILTIN_AGENTS } from "../src/lib/agent-defs-pure.ts";

const nodeRequire = createRequire(import.meta.url);

// The scorecard runs each case itself with runTask. Its task row must never be "queued" between insert and that call:
// kickQueue (which only takes queued rows) would otherwise start the same case a second time, outside the scorecard's budget.
test("the scorecard inserts its case tasks running and unowned, so only its own runTask starts them", async () => {
  const inserted: Record<string, unknown>[] = [];
  const sb = { from: () => { const c: Record<string, unknown> = {
    insert: (v: Record<string, unknown>) => (inserted.push(v), c), select: () => c, eq: () => c, maybeSingle: async () => ({ data: { pending: [] }, error: null }),
    single: async () => ({ data: { id: `t${inserted.length}` }, error: null }), then: (ok: (r: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok),
  }; return c; } };
  const exports: Record<string, any> = {};
  const src = ts.transpileModule(readFileSync(new URL("../src/lib/agent-replay.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const dir = mkdtempSync(path.join(tmpdir(), "orbit-score-"));
  vm.runInNewContext(src, { exports, console, process: { env: {}, pid: 1 }, setTimeout, require: (n: string) => ({
    "./agent-replay-pure": replayPure, "../../evals/agent-replay-cases": { REPLAY_CASES }, "./data-dir": { orbitDataDir: () => dir },
    "./agents": { BUILTIN_AGENTS, runTask: async () => ({ status: "done", result: "ok" }), resolvePending: async () => {} },
    "./claude": { MODEL: "m", recordUsage: async () => {}, createBudget: () => ({ used: 0, signal: new AbortController().signal }), askClaude: async () => ({ text: '{"a":{"score":3},"b":{"score":3}}' }) },
    "./stop-all": { stopAllOn: () => false }, "./usage-meter": { usageHold: () => "", usageLimited: () => false },
    "./safe-file.ts": { readStore: async () => "", writeStore: async () => {}, updateStore: async (_f: string, fn: (t: string) => { out: unknown }) => fn("").out }, // #413: the scorecard's state file goes through safe-file
  } as Record<string, unknown>)[n] ?? nodeRequire(n) });
  const why = await exports.runScorecard(sb, "u", "manual");
  assert.equal(why, "", "the run started");
  const tasks = inserted.filter((r) => String(r.title ?? "").startsWith("Scorecard:"));
  assert.ok(tasks.length >= 1);
  for (const t of tasks) { assert.equal(t.status, "running"); assert.equal(typeof t.started_at, "string"); }
});
