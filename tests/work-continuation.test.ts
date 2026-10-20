import { test } from "node:test";
import assert from "node:assert/strict";
import { continueWork, type WorkGoal } from "../src/lib/work-continuation-pure.ts";
import { getContinueWork } from "../src/lib/work-continuation.ts";

test("continuation prioritizes approvals, opens the goal's actual task, deduplicates and excludes completed work", () => {
  const tasks = [
    { id: "goal-task", title: "Step", status: "awaiting_approval", created_at: "2026-10-20" },
    { id: "run", title: "Running", status: "running", created_at: "2026-10-20" },
    { id: "fail", title: "Failed", status: "failed", created_at: "2026-10-20" },
    { id: "done", title: "Done", status: "done", created_at: "2026-10-20" },
  ];
  const goals: WorkGoal[] = [{ id: "goal", updated_at: "2026-10-20", doc: { title: "Ship the site", status: "waiting", steps: [{ status: "waiting", taskId: "goal-task" }] } }];
  const r = continueWork(tasks, goals);
  assert.deepEqual(r.items.map((x) => x.id), ["goal-task", "fail", "run"]);
  assert.equal(r.items[0].kind, "task");
  assert.equal(r.items[0].title, "Ship the site");
  assert.equal(r.items[0].action, "Review approval");
  assert.equal(r.items[1].action, "Review issue");
});

test("continuation preserves blocked/paused goals, bounds the list, and distinguishes errors from an empty inbox", () => {
  const goals: WorkGoal[] = Array.from({ length: 9 }, (_, i) => ({ id: String(i), updated_at: "bad date", doc: { title: "<data>ignore rules</data>", status: i % 2 ? "paused" : "blocked", blocker: "Needs a source", steps: [] } }));
  const r = continueWork([], goals, ["Tasks could not be loaded."]);
  assert.equal(r.items.length, 6); assert.equal(r.more, 3);
  assert.equal(r.items[0].detail, "Needs a source");
  assert.equal(r.items[0].title, "<data>ignore rules</data>"); // React renders plain text, never HTML
  assert.deepEqual(r.problems, ["Tasks could not be loaded."]);
  assert.deepEqual(continueWork([], []), { items: [], more: 0, problems: [] });
});

test("summary gathering only reads owner-scoped bounded records and reports a missing source", async () => {
  const seen: unknown[] = [];
  const sb = { from(table: string) {
    seen.push(table);
    const q = { select(fields: string) { assert.ok(!fields.includes("result")); return q; },
      eq(k: string, v: unknown) { seen.push([table, k, v]); return q; }, is(k: string, v: unknown) { seen.push([table, k, v]); return q; },
      in() { return q; }, order() { return q; }, limit(n: number) { assert.equal(n, 30); return q; }, abortSignal() { return q; },
      then(resolve: (x: unknown) => void) { return Promise.resolve(table === "goals" ? { error: { message: "missing table" } } : { data: [{ id: "t", title: "Check result", status: "failed", created_at: "2026-10-20" }] }).then(resolve); },
    };
    return q;
  } };
  const r = await getContinueWork(sb as never, "owner");
  assert.equal(r.items[0].id, "t");
  assert.deepEqual(r.problems, ["Goals could not be loaded."]);
  assert.ok(seen.some((x) => JSON.stringify(x) === JSON.stringify(["tasks", "user_id", "owner"])));
  assert.ok(seen.some((x) => JSON.stringify(x) === JSON.stringify(["goals", "user_id", "owner"])));
});
