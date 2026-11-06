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

// ── "Continue my work" accuracy (failure reasons, evaluations, execution evidence, history) ──
import { failureReason, isEvaluation } from "../src/lib/work-continuation-pure.ts";
const CASES = [{ title: "Compare two game engines", request: "Compare Godot and Unity…", agent: "atlas" }];
const T = (o: Record<string, unknown>) => ({ id: "x", title: "Task", status: "failed", created_at: "2026-11-03T08:00:00Z", ...o }) as Parameters<typeof continueWork>[0][number];

test("a failed task shows its stored reason, the attempt date and a fitting next step", () => {
  const [i] = continueWork([T({ id: "f", started_at: "2026-11-03T08:01:00Z", error: "Error: Claude usage limit reached until 14:00\nstack…" })], []).items;
  assert.match(i.detail, /^Failed Tue 3 Nov: Claude usage limit reached until 14:00$/);
  assert.equal(i.at, "2026-11-03T08:01:00Z");
  assert.equal(i.next, "Wait until Claude's limit resets, then Retry");
  assert.equal(i.action, "Review issue");
  assert.match(failureReason(T({ error: "Interrupted: ORBIT restarted while this ran. Resumable: press Retry" })).next, /ORBIT restarted during it: Retry/);
  assert.deepEqual(failureReason(T({ error: null })), { reason: "No reason was recorded", next: "Open it to see what failed, then Retry" });
  // no error text: the receipt's failed step is the reason
  const rc = { asked: "x", accept: "", status: "failed", verified: [], claimed: [], failed: ["save_lead: the row was not found when read back"], links: [] };
  assert.match(failureReason(T({ trace: [{ step: "receipt", receipt: rc }] })).reason, /save_lead: the row was not found/);
});

test("evaluation tasks are not personal work: explicit origin, or an exact case match; a look-alike title alone isn't enough", () => {
  const own = T({ id: "own", title: "Scorecard: Compare two game engines", request: "my own request", agent: "atlas" });
  const legacy = T({ id: "old", title: "Scorecard: Compare two game engines", request: "Compare Godot and Unity…", agent: "atlas" });
  const tagged = T({ id: "new", title: "anything", origin: "scorecard" });
  assert.equal(isEvaluation(own, CASES), false, "same title, different request: his task stays");
  assert.equal(isEvaluation(legacy, CASES), true);
  assert.equal(isEvaluation(tagged, CASES), true);
  assert.equal(isEvaluation({ ...legacy, origin: "owner" } as never, CASES), false, "an explicit origin wins");
  assert.deepEqual(continueWork([own, legacy, tagged], [], [], CASES).items.map((x) => x.id), ["own"]);
});

test("running: only live execution evidence shows 'working'; old age alone neither fails nor confirms a task", () => {
  const old = "2026-11-01T08:00:00Z"; // days ago
  const r = continueWork([T({ id: "live", status: "running", started_at: old, exec: "active" }), T({ id: "ghost", status: "running", started_at: old, exec: "unknown" }),
    T({ id: "boot", status: "running", started_at: old, exec: "restart" }), T({ id: "q", status: "queued" })], []);
  const by = Object.fromEntries(r.items.map((x) => [x.id, x]));
  assert.equal(by.live.status, "running", "a long task with a live worker stays active");
  assert.equal(by.live.detail, "Agent is working on it now");
  assert.equal(by.ghost.status, "uncertain");
  assert.match(by.ghost.detail, /no worker in ORBIT is running it now/);
  assert.equal(by.boot.status, "uncertain");
  assert.match(by.boot.detail, /before ORBIT restarted/);
  assert.equal(by.q.detail, "Waiting for an agent slot");
  assert.equal(continueWork([T({ status: "running" })], []).items[0].status, "uncertain", "no evidence at all is never 'working'");
});

test("history: an older failed run of an automation reads as an earlier attempt once a newer run succeeded; titles never link records", () => {
  const failed = T({ id: "brief-old", title: "⚙ Morning Brief", automation_id: "a1", started_at: "2026-11-04T07:30:00Z", error: "all feeds timed out" });
  const r = continueWork([failed, T({ id: "other", title: "⚙ Morning Brief", automation_id: null, started_at: "2026-11-04T07:31:00Z", error: "x" })], [], [], [], { a1: "2026-11-06T07:30:00Z" });
  const old = r.items.find((x) => x.id === "brief-old")!;
  assert.match(old.detail, /^Earlier attempt \(Wed 4 Nov\): all feeds timed out\. A newer run succeeded Fri 6 Nov\.$/);
  assert.match(old.next!, /Nothing to redo/);
  assert.equal(r.items.at(-1)!.id, "brief-old", "kept for inspection, ranked below current problems");
  assert.match(r.items.find((x) => x.id === "other")!.detail, /^Failed /, "same title, no automation id: not linked");
  assert.match(continueWork([failed], [], [], [], { a1: "2026-11-03T07:30:00Z" }).items[0].detail, /^Failed /, "a success from before the failure doesn't hide it");
});

test("gathering: exec evidence and automation_id links come from the records; before migration 0025 the origin column is skipped", async () => {
  const calls: string[] = [];
  const rows: Record<string, unknown[]> = {
    tasks: [{ id: "r", title: "Run", status: "running", created_at: "2026-11-06T08:00:00Z", started_at: "2026-11-06T08:00:00Z" },
      { id: "f", title: "⚙ Brief", status: "failed", created_at: "2026-11-05T07:30:00Z", automation_id: "a1", error: "boom" }],
    done: [{ automation_id: "a1", started_at: "2026-11-06T07:30:00Z", created_at: "2026-11-06T07:30:00Z" }],
  };
  const sb = { from(table: string) {
    let cols = "", status = "";
    const q = { select(c: string) { cols = c; calls.push(`${table}:${c.includes("origin") ? "with-origin" : "plain"}`); return q; },
      eq(k: string, v: string) { if (k === "status") status = v; return q; }, is() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, abortSignal() { return q; },
      then(ok: (x: unknown) => void) {
        const r = table === "goals" ? { data: [] } : cols.includes("origin") ? { error: { code: "42703", message: "column tasks.origin does not exist" } } : { data: status === "done" ? rows.done : rows.tasks };
        return Promise.resolve(r).then(ok);
      } };
    return q;
  } } as never;
  const s = await getContinueWork(sb, "u1", (id) => (id === "r" ? "active" : "unknown"));
  assert.deepEqual(calls.filter((c) => c.startsWith("tasks")).slice(0, 2), ["tasks:with-origin", "tasks:plain"], "retried without origin");
  assert.equal(s.problems.length, 0);
  assert.equal(s.items.find((x) => x.id === "r")!.status, "running");
  assert.match(s.items.find((x) => x.id === "f")!.detail, /^Earlier attempt/);
});
