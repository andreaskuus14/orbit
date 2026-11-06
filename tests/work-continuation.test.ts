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
      in() { return q; }, or() { return q; }, order() { return q; }, limit(n: number) { assert.equal(n, 30); return q; },
      range(a: number, b: number) { assert.equal(b - a + 1, 30, "bounded pages"); return q; }, abortSignal() { return q; },
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
  assert.match(by.ghost.detail, /ORBIT found no worker running it, so it may have stopped/);
  assert.equal(by.boot.status, "uncertain");
  assert.match(by.boot.detail, /before ORBIT restarted/);
  assert.equal(by.q.detail, "Waiting for an agent slot");
  assert.equal(continueWork([T({ status: "running" })], []).items[0].status, "uncertain", "no evidence at all is never 'working'");
});

test("history: an older failed run of an automation reads as an earlier attempt once a newer run succeeded; titles never link records", () => {
  const failed = T({ id: "brief-old", title: "⚙ Morning Brief", automation_id: "a1", started_at: "2026-11-04T07:30:00Z", error: "all feeds timed out" });
  const r = continueWork([failed, T({ id: "other", title: "⚙ Morning Brief", automation_id: null, started_at: "2026-11-04T07:31:00Z", error: "x" })], [], [], [], { a1: { at: "2026-11-06T07:30:00Z", verified: true } });
  const old = r.items.find((x) => x.id === "brief-old")!;
  assert.match(old.detail, /^Earlier attempt \(Wed 4 Nov\): all feeds timed out\. A newer run succeeded Fri 6 Nov \(verified\)\.$/);
  assert.match(old.next!, /Nothing to redo/);
  assert.equal(r.items.at(-1)!.id, "brief-old", "kept for inspection, ranked below current problems");
  assert.match(r.items.find((x) => x.id === "other")!.detail, /^Failed /, "same title, no automation id: not linked");
  assert.match(continueWork([failed], [], [], [], { a1: { at: "2026-11-03T07:30:00Z", verified: true } }).items[0].detail, /^Failed /, "a success from before the failure doesn't hide it");
  const unv = continueWork([failed], [], [], [], { a1: { at: "2026-11-06T07:30:00Z", verified: false } }).items[0];
  assert.match(unv.detail, /A newer run finished Fri 6 Nov, but its result isn't verified\.$/, "an unverified newer run isn't called a success");
  assert.equal(unv.next, "Check the newer run's result before relying on it");
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
      eq(k: string, v: string) { if (k === "status") status = v; return q; }, is() { return q; }, in() { return q; }, or() { return q; }, order() { return q; }, limit() { return q; }, range() { return q; }, abortSignal() { return q; },
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

// fake Supabase that honours eq/in/or(origin)/order/range/limit over real rows, so paging and filters are exercised for real
function db(tables: Record<string, Record<string, unknown>[]>, opts: { origin: boolean }) {
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])], cols = "", from = 0, to = Infinity;
    const q = {
      select(c: string) { cols = c; return q; },
      eq(k: string, v: unknown) { rows = rows.filter((r) => r[k] === v); return q; }, is(k: string, v: unknown) { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      in(k: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[k])); return q; },
      or(f: string) { if (f === "origin.is.null,origin.neq.scorecard") rows = rows.filter((r) => r.origin == null || r.origin !== "scorecard"); return q; },
      order(k: string, o: { ascending: boolean }) { rows.sort((a, b) => (o.ascending ? 1 : -1) * String(a[k]).localeCompare(String(b[k]))); return q; },
      range(a: number, b: number) { from = a; to = b; return q; }, limit(n: number) { to = Math.min(to, from + n - 1); return q; }, abortSignal() { return q; },
      then(ok: (x: unknown) => void) {
        if (cols.includes("origin") && !opts.origin) return Promise.resolve({ data: null, error: { code: "42703", message: "column tasks.origin does not exist" } }).then(ok);
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(ok);
      },
    };
    return q;
  } } as never;
}
const ts = (i: number) => new Date(Date.UTC(2026, 10, 6, 9, 0, 0) - i * 60_000).toISOString();
const evalRows = (n: number, legacy: boolean) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, user_id: "u1", parent_id: null, status: "failed", created_at: ts(i), error: "rubric failed",
  ...(legacy ? { title: `Scorecard: ${REPLAY_CASES[0].title}`, request: REPLAY_CASES[0].request, agent: REPLAY_CASES[0].agent } : { title: "Scorecard: x", origin: "scorecard" }) }));
const approval = { id: "mine", user_id: "u1", parent_id: null, status: "awaiting_approval", created_at: ts(40), title: "Send the invoice to Mari", origin: null };
const { REPLAY_CASES } = await import("../evals/agent-replay-cases.ts");

test("30 scorecard rows can't push a real approval off the card: filtered before the cap (with 0025) or paged past (before it)", async () => {
  for (const origin of [true, false]) {
    const s = await getContinueWork(db({ tasks: [...evalRows(30, !origin), approval], goals: [] }, { origin }), "u1", () => "active");
    assert.deepEqual(s.items.map((x) => x.id), ["mine"], `origin column ${origin ? "present" : "missing"}`);
    assert.equal(s.problems.length, 0);
  }
  const many = await getContinueWork(db({ tasks: [...evalRows(70, true), approval], goals: [] }, { origin: false }), "u1", () => "active");
  assert.deepEqual(many.items.map((x) => x.id), ["mine"], "found on the third page");
  assert.deepEqual(many.problems, [], "the scan finished: nothing left unchecked");
  // past the 150-row scan limit: the card says some tasks weren't checked, never "caught up"
  const deep = await getContinueWork(db({ tasks: [...evalRows(160, true), { ...approval, created_at: ts(200) }], goals: [] }, { origin: false }), "u1", () => "active");
  assert.deepEqual(deep.items, []);
  assert.deepEqual(deep.problems, ["Some older tasks weren't checked."]);

});

test("a newer 'done' run only clears an earlier failure when its receipt doesn't say it failed", async () => {
  const failed = { id: "f", user_id: "u1", parent_id: null, status: "failed", created_at: "2026-11-04T07:30:00Z", started_at: "2026-11-04T07:30:00Z", title: "⚙ Brief", automation_id: "a1", error: "boom", origin: null };
  const rc = (status: string) => [{ step: "receipt", receipt: { asked: "x", accept: "", status, verified: status === "verified" ? ["briefing saved"] : [], claimed: [], failed: status === "failed" ? ["briefing not found on read-back"] : [], links: [] } }];
  const done = (status: string) => ({ id: `d-${status}`, user_id: "u1", parent_id: null, status: "done", automation_id: "a1", title: "⚙ Brief", request: "x", created_at: "2026-11-06T07:30:00Z", started_at: "2026-11-06T07:30:00Z", pending: [], trace: rc(status) });
  const card = async (d: Record<string, unknown>) => (await getContinueWork(db({ tasks: [failed, d], goals: [] }, { origin: true }), "u1", () => "active")).items[0];
  assert.match((await card(done("failed"))).detail, /^Failed Wed 4 Nov: boom$/, "done with a failed receipt is not a success");
  assert.match((await card(done("partly"))).detail, /^Failed /, "partly verified doesn't clear it either");
  assert.match((await card(done("verified"))).detail, /A newer run succeeded Fri 6 Nov \(verified\)/);
  assert.match((await card(done("unverified"))).detail, /finished Fri 6 Nov, but its result isn't verified/);
});

test("running without evidence: 'unknown' says it may have stopped, 'unchecked' says it couldn't be confirmed; neither claims inactivity as fact", () => {
  const r = (exec: string) => continueWork([T({ status: "running", started_at: "2026-11-06T08:00:00Z", exec })], []).items[0];
  assert.match(r("unknown").detail, /ORBIT found no worker running it, so it may have stopped/);
  assert.match(r("unchecked").detail, /couldn't confirm whether it is still running/);
  for (const e of ["unknown", "unchecked"]) {
    assert.doesNotMatch(r(e).detail, /no worker in ORBIT is running it now/);
    assert.equal(r(e).next, "Open it to see its progress before retrying anything");
  }
});
