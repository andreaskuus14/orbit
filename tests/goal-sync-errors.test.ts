import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as goals from "../src/lib/goals-pure.ts";

function harness(taskResult: { data: unknown; error: unknown }) {
  const input = goals.validateGoal({ title: "Prepare a research report", agents: ["atlas"], metric: { kind: "none" } }, ["atlas"]);
  assert.ok(typeof input !== "string");
  const doc = goals.newGoal(input);
  goals.setPlan(doc, ["Research", "Draft", "Review"].map((what) => ({ what, agent: "atlas", expected: "report", needsApproval: false })));
  goals.approvePlan(doc, doc.steps.map((s) => s.id));
  goals.startStep(doc, 0, "original-task", doc.steps[0].id);
  let row = { id: "goal", status: doc.status, version: 1, doc };
  let taskReads = 0, goalWrites = 0, notifications = 0;
  const taskScopes: unknown[] = [], errors: unknown[] = [];
  const sb = { from(table: string) {
    let patch: Record<string, unknown> | null = null;
    const q = {
      select() { return q; },
      eq(key: string, value: unknown) { if (table === "tasks" && key === "user_id") taskScopes.push(value); return q; },
      update(value: Record<string, unknown>) { patch = value; return q; },
      maybeSingle() {
        if (table === "tasks") { taskReads++; return Promise.resolve(taskResult); }
        assert.equal(table, "goals"); return Promise.resolve({ data: structuredClone(row), error: null });
      },
      then(resolve: (r: unknown) => void) {
        assert.equal(table, "goals"); assert.ok(patch);
        goalWrites++; row = { ...row, ...structuredClone(patch) };
        return Promise.resolve({ data: [structuredClone(row)], error: null }).then(resolve);
      },
    };
    return q;
  } };
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/lib/goals.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, AbortController, console: { error: (...args: unknown[]) => errors.push(args) }, require: (name: string) =>
    name === "./goals-pure" ? goals : name === "./stop-all" ? { stopAllOn: () => false }
      : name === "./usage-meter" ? { usageHold: () => false }
      : name === "./claude" ? { emit: async () => { notifications++; }, askClaude: () => { throw Error("No model call expected"); } } : {},
  });
  return { taskResult, errors, row: () => row,
    counts: () => ({ taskReads, goalWrites, notifications, taskScopes }),
    advance: () => exports.advance(sb, "owner", "goal"),
  };
}

test("a transient task-read failure cannot mark a goal blocked or discard its original task", async () => {
  const h = harness({ data: null, error: { message: "temporary database outage" } });
  await h.advance();
  assert.equal(h.row().doc.status, "running");
  assert.equal(h.row().doc.steps[0].status, "running");
  assert.equal(h.row().doc.steps[0].taskId, "original-task");
  assert.equal(h.counts().goalWrites, 0);
  assert.equal(h.counts().notifications, 0);
  assert.equal(h.errors.length, 1);
  h.taskResult.error = null;
  h.taskResult.data = { status: "running", started_at: new Date().toISOString() };
  await h.advance();
  assert.equal(h.counts().taskReads, 2, "the driver must release its lock and retry on the next event");
  assert.equal(h.row().doc.steps[0].taskId, "original-task");
  assert.equal(h.counts().goalWrites, 0);
});

test("a genuinely missing task still blocks the goal", async () => {
  const h = harness({ data: null, error: null });
  await h.advance();
  assert.equal(h.row().doc.status, "blocked");
  assert.match(h.row().doc.steps[0].error!, /task is gone/);
  assert.equal(h.counts().goalWrites, 1);
  assert.equal(h.counts().notifications, 1);
});

test("sync reads only the signed-in owner's task and preserves running work", async () => {
  const h = harness({ data: { status: "running", started_at: new Date().toISOString() }, error: null });
  await h.advance();
  assert.deepEqual(h.counts().taskScopes, ["owner"]);
  assert.equal(h.row().doc.status, "running");
  assert.equal(h.counts().goalWrites, 0);
  assert.equal(h.errors.length, 0);
});
