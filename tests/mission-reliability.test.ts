import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as completionPure from "../src/lib/completion-pure.ts";
import * as chainsPure from "../src/lib/chains-pure.ts";
import * as companyPure from "../src/lib/company-pure.ts";
import * as missionsPure from "../src/lib/missions-pure.ts";
import * as taskClaimPure from "../src/lib/task-claim-pure.ts";

// Review of 1c4cd6c, findings 2/4/5: the real runner modules, loaded with fakes for the database and the agent/Claude imports.

type Row = Record<string, any>;
/** Minimal in-memory Supabase: select/update with eq/in/is/lt filters, single/maybeSingle, awaited lists. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; patch: object }[] = [];
  const sb = { from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = []; let patch: object | null = null;
    const q: any = {
      select() { return q; }, order() { return q; }, limit() { return q; }, like() { return q; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
      in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
      is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
      lt(k: string, v: string) { filters.push((r) => r[k] < v); return q; },
      update(p: object) { patch = p; return q; },
      exec(single = false) {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) { writes.push({ table, patch }); for (const r of hit) Object.assign(r, structuredClone(patch)); }
        return { data: single ? structuredClone(hit[0] ?? null) : structuredClone(hit), error: null };
      },
      single() { return Promise.resolve(q.exec(true)); }, maybeSingle() { return Promise.resolve(q.exec(true)); },
      then(ok: (r: unknown) => void, bad: (e: unknown) => void) { return Promise.resolve(q.exec()).then(ok, bad); },
    };
    return q;
  } };
  return { sb, writes };
}

function load(file: string, mods: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx: Record<string, any> = { exports, console, setTimeout, AbortController, crypto, require: (n: string) => mods[n] ?? {}, ...extra };
  vm.runInNewContext(source, ctx);
  return { exports, ctx };
}

test("(a) pause while waiting for a worker slot: freeing the slot does not start the step", { timeout: 10_000 }, async () => {
  const meta = chainsPure.toMeta({ goal: "g", steps: [{ agent: "nova", request: "one" }, { agent: "nova", request: "two" }] });
  const { sb } = fakeDb({ tasks: [
    { id: "chain", parent_id: null, status: "running", request: JSON.stringify(meta), project_id: null },
    { id: "s1", parent_id: "chain", agent: "nova", title: chainsPure.stepTitle(0, 2, "nova", "one"), request: "one", status: "queued", result: null, error: null },
    { id: "s2", parent_id: "chain", agent: "nova", title: chainsPure.stepTitle(1, 2, "nova", "two"), request: "two", status: "queued", result: null, error: null },
  ] });
  let runs = 0;
  const { exports, ctx } = load("lib/chains.ts", {
    "./agents": { runTask: async () => { runs++; return { status: "done" }; }, kickQueue: () => {}, cancelTask: async () => false },
    "./stop-all": { stopAllOn: () => false }, "./claude": { emit: async () => {}, createBudget: () => ({}) },
    "./completion-pure": completionPure, "./company-pure": companyPure, "./chains-pure": chainsPure,
  });
  ctx.__orbitTaskQueue = new Set(["other-1", "other-2"]); // both slots busy
  let paused = false, gates = 0;
  const driving = exports.drive(sb, "owner", "chain", async () => { gates++; return !paused; });
  for (let i = 0; gates === 0 && i < 300; i++) await new Promise((r) => setTimeout(r, 10)); // passed the first pause check, now waiting for a slot
  paused = true;
  ctx.__orbitTaskQueue.clear(); // capacity frees up after the pause
  assert.equal(await driving, null);
  assert.equal(runs, 0, "the step must not start after a pause during the wait");
  assert.equal(ctx.__orbitTaskQueue.size, 0, "the slot is handed back");
});

test("(b) reading missions (panel GET, CORE mission_status) never calls the driver or writes", async () => {
  const doc = { ...missionsPure.newDoc("obj", [], "2026-01-01T00:00:00Z"), status: "running" };
  const tables = {
    missions: [{ id: "m1", user_id: "owner", chain_id: "chain", version: 1, status: "running", doc, created_at: "2026-01-01" }],
    tasks: [{ id: "s1", parent_id: "chain", status: "failed", pending: [] }, { id: "s2", parent_id: "chain", status: "queued", pending: [] }],
  };
  const { sb, writes } = fakeDb(tables);
  let drives = 0, resumeFlag: unknown;
  const chain = () => { // the chain's view from the fake rows (a temporary failure on step 1)
    const s1 = tables.tasks[0].status;
    return { chainId: "chain", goal: "obj", status: s1 === "failed" ? "failed" : "running", steps: [
      { index: 0, agent: "nova", request: "", taskId: "s1", status: s1, error: "ETIMEDOUT" },
      { index: 1, agent: "nova", request: "", taskId: "s2", status: "queued" },
    ] };
  };
  const { exports } = load("lib/missions.ts", {
    "./chains": { getChain: async (_sb: unknown, _u: unknown, _id: unknown, resume: unknown) => { resumeFlag = resume; return chain(); }, drive: async () => { drives++; return null; }, cancelChain: async () => false, createChain: async () => ({}) },
    "./missions-pure": missionsPure, "./durable": { noteWrite: () => {} },
  });
  const ms = await exports.listMissions(sb, "owner");
  assert.equal(ms.length, 1);
  assert.equal(resumeFlag, false);
  const out = await exports.runMissionTool(sb, "owner", "mission_status", {}, "status?", false);
  assert.match(out, /obj/);
  assert.equal(drives, 0, "a read must not drive");
  assert.deepEqual(writes, [], "a read must not save, requeue or retry");
  // The scheduler tick does advance: the temporary failure is retried and the chain driven.
  await exports.resumeMissions(sb, "owner");
  assert.equal(tables.tasks[0].status, "queued", "the tick requeues the temporarily failed step");
  assert.equal(drives, 1);
});

test("(c) crash after an approved write but before its receipt: recovery reports uncertain and never re-executes", async () => {
  const { sb } = fakeDb({ tasks: [{ id: "step", user_id: "owner", parent_id: null, project_id: null, status: "awaiting_approval", agent: "nova", title: "t", request: "",
    pending: [{ tool: "save_memory", input: {}, status: "pending" }] }] });
  const tasks = () => (sb as any).from("tasks").select().eq("id", "step").maybeSingle().then((r: any) => r.data);
  const { exports } = load("lib/agents.ts", { "./completion-pure": completionPure, "./task-claim-pure": taskClaimPure, "./memory": { KINDS: ["note"] }, "./claude": { emit: async () => {} }, "./stop-all": { stopAllOn: () => false } });
  let writesDone = 0;
  exports.TOOLS.save_memory.run = () => { writesDone++; return new Promise(() => {}); }; // the write happens, then the process dies (never returns)
  void exports.resolvePending(sb, "owner", "step", true);
  await new Promise((r) => setTimeout(r, 20));
  let t = await tasks();
  assert.equal(writesDone, 1);
  assert.equal(t.status, "running");
  assert.deepEqual([t.pending[0].status, t.pending[0].attempt], ["attempting", "step:0"], "the attempt and its stable id are on record before the action ran");

  // Restart: the stale sweep / chain driver finds it running with no runner.
  await (sb as any).from("tasks").update(completionPure.interruptedPatch(t.pending, "Interrupted (ORBIT restarted)")).eq("id", "step").eq("status", "running");
  t = await tasks();
  assert.equal(t.status, "failed");
  assert.equal(t.pending[0].status, "uncertain");
  assert.match(t.pending[0].note, /Needs inspection/);
  assert.match(t.error, /Needs inspection/);

  // Nothing re-executes it: the approval can't be replayed, the task Retry refuses, the mission doesn't auto-retry.
  await assert.rejects(() => exports.resolvePending(sb, "owner", "step", true), /Nothing is waiting/);
  assert.equal(completionPure.canRetryTask(t.pending), false);
  const f = missionsPure.onFailure({ index: 0, error: "Interrupted (ORBIT restarted)" }, {}, missionsPure.acted(t.pending));
  assert.equal(f.do, "stop");
  assert.equal(f.do === "stop" && f.status, "waiting-input");
  assert.equal(completionPure.completionState(t.pending).status, "failed");
  assert.equal(writesDone, 1);
});

test("successful approval saves the receipt over the attempt; no attempt → interruption stays a plain retryable failure", async () => {
  const { sb } = fakeDb({ tasks: [{ id: "x", user_id: "owner", parent_id: null, project_id: null, status: "awaiting_approval", agent: "nova", title: "t", request: "",
    pending: [{ tool: "save_memory", input: {}, status: "pending" }] }] });
  const { exports } = load("lib/agents.ts", { "./completion-pure": completionPure, "./task-claim-pure": taskClaimPure, "./memory": { KINDS: ["note"] }, "./claude": { emit: async () => {} }, "./stop-all": { stopAllOn: () => false } });
  exports.TOOLS.save_memory.run = async (ctx: any) => { ctx.evidence.push({ kind: "memory", id: "m1" }); return "Saved"; };
  const pending = await exports.resolvePending(sb, "owner", "x", true);
  assert.deepEqual([pending[0].status, pending[0].attempt, pending[0].evidence[0].id], ["approved", "x:0", "m1"]);
  const p = completionPure.interruptedPatch([{ status: "pending" }], "Interrupted (ORBIT restarted)");
  assert.equal(p.error, "Interrupted (ORBIT restarted)");
  assert.equal(p.pending[0].status, "pending");
});
