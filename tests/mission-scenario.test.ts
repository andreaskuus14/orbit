import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as completionPure from "../src/lib/completion-pure.ts";
import * as answerCallPure from "../src/lib/answer-call-pure.ts";
import * as chainsPure from "../src/lib/chains-pure.ts";
import * as companyPure from "../src/lib/company-pure.ts";
import * as missionsPure from "../src/lib/missions-pure.ts";
import * as taskClaimPure from "../src/lib/task-claim-pure.ts";
import * as stopAllPure from "../src/lib/stop-all-pure.ts";
import * as pure from "../src/lib/pure.ts";
import * as foregroundPure from "../src/lib/foreground-pure.ts";
import * as clipStorePure from "../src/lib/clip-store-pure.ts";
import * as memoryTypesPure from "../src/lib/memory-types-pure.ts";
import * as missionChecksPure from "../src/lib/mission-checks-pure.ts";
import * as researchPilotPure from "../src/lib/research-pilot-pure.ts";
import * as agentDefsPure from "../src/lib/agent-defs-pure.ts";
import * as modelLogPure from "../src/lib/model-log-pure.ts";
import { blockedMsg, type GuardedId } from "../src/lib/version-pure.ts";
import { MODULE_HINTS, selectModules } from "../src/lib/core-modules-pure.ts";
import * as execution from "../src/lib/execution.ts"; // the real execution-evidence module agents.ts uses

// Phase 2 gate, end to end: the REAL runner files (agents.ts, chains.ts, missions.ts + completion-pure) on an in-memory Supabase.
// Each "process" is a fresh vm context (fresh globalThis: slots, live tasks, driver set, worker id); the DB and the data dir are shared.

process.env.ORBIT_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "orbit-scenario-"));
const stopAll = await import("../src/lib/stop-all.ts"); // real Stop-all, off (file absent in the temp data dir)

type Row = Record<string, any>;
let DBG: Row | undefined;
const until = async (cond: () => unknown, what: string) => {
  for (let i = 0; i < 1500; i++) { if (await cond()) return; await new Promise((r) => setTimeout(r, 2)); }
  throw new Error(`timed out waiting: ${what} ${JSON.stringify(DBG?.tables, (k, v) => (k === "trace" ? undefined : v)).slice(0, 3000)}`);
};

/** In-memory Supabase. Every query runs synchronously inside one exec(), so a conditional update is atomic (like Postgres). */
class MigrationBlocked extends Error {}
const guard = (missing: Set<string>) => ({ // migration-guard stub: the real refusal message for a missing guarded migration
  MigrationBlocked,
  requireMigration: async (_sb: unknown, id: GuardedId) => { if (missing.has(id)) throw new MigrationBlocked(blockedMsg(id)); },
  refuse: (id: GuardedId) => new MigrationBlocked(blockedMsg(id)),
});
function fakeDb(noAttemptCol = false) {
  const tables: Record<string, Row[]> = { tasks: [], missions: [] };
  let seq = 0;
  const DEFAULTS: Record<string, Row> = {
    tasks: { status: "queued", parent_id: null, project_id: null, result: null, error: null, pending: [], trace: [], started_at: null, finished_at: null, claimed_by: null },
    missions: { version: 1 },
  };
  const term = (t: string): ((r: Row) => boolean) => { // PostgREST or() term: col.op.value or and(...)
    if (t.startsWith("and(")) { const parts = split(t.slice(4, -1)).map(term); return (r) => parts.every((f) => f(r)); }
    const [col, op, ...rest] = t.split("."); const v = rest.join(".").replace(/^"|"$/g, "");
    if (op === "eq") return (r) => String(r[col]) === v;
    if (op === "is") return (r) => (r[col] ?? null) === null;
    if (op === "lt") return (r) => r[col] != null && r[col] < v;
    throw new Error(`fake db: or op ${op}`);
  };
  const split = (s: string) => { const out: string[] = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur); cur = ""; } else cur += ch; } if (cur) out.push(cur); return out; };
  const sb = { from(table: string) {
    const rows = (tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null, ins: Row[] | null = null, del = false, badCol = false;
    const q: any = {
      select() { return q; }, order() { return q; }, limit() { return q; },
      eq(k: string, v: unknown) { badCol ||= noAttemptCol && k === "attempt_id"; filters.push((r) => r[k] === v); return q; },
      contains(k: string, vs: unknown[]) { filters.push((r) => vs.every((v) => (r[k] ?? []).includes(v))); return q; },
      neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return q; },
      in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return q; },
      is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return q; },
      lt(k: string, v: string) { filters.push((r) => r[k] < v); return q; },
      like(k: string, p: string) { filters.push((r) => String(r[k]).startsWith(p.replace(/%$/, ""))); return q; },
      or(f: string) { const fs = split(f).map(term); filters.push((r) => fs.some((x) => x(r))); return q; },
      update(p: Row) { patch = p; return q; }, delete() { del = true; return q; },
      insert(x: Row | Row[]) { ins = (Array.isArray(x) ? x : [x]).map((r) => ({ ...DEFAULTS[table], id: `${table[0]}${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...structuredClone(r) })); return q; },
      exec(single = false) {
        if (badCol || (noAttemptCol && ins?.some((r) => "attempt_id" in r))) return { data: null, error: { code: "42703", message: "column attempt_id does not exist" } };
        if (ins) { rows.push(...ins); const out = structuredClone(ins); return { data: single ? out[0] : out, error: null }; }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (del) for (const r of hit) rows.splice(rows.indexOf(r), 1);
        if (patch) for (const r of hit) Object.assign(r, structuredClone(patch));
        return { data: single ? structuredClone(hit[0] ?? null) : structuredClone(hit), error: null };
      },
      single() { return Promise.resolve(q.exec(true)); }, maybeSingle() { return Promise.resolve(q.exec(true)); },
      then(ok: (r: unknown) => void, bad: (e: unknown) => void) { return Promise.resolve().then(() => q.exec()).then(ok, bad); },
    };
    return q;
  } };
  return { sb, tables };
}

type World = ReturnType<typeof world>;
function world(req: string[]) {
  const db = fakeDb();
  const w = {
    ...db, req,
    writes: 0, dest: new Map<string, string>(), crashNext: false, // the fake destination: what actually landed, keyed by idempotency key
    proposals: 0, calls: [0, 0, 0], hang: -1, // hang: the step index whose next model call never returns (the process dies mid-step)
  };
  return w;
}

/** The model: step 1 answers; step 2 proposes one write (needs approval) then answers; step 3 answers. */
function model(w: World, p: { ctx: Row }, prompt: string) {
  const k = [2, 1, 0].find((i) => prompt.includes(`REQUEST:\n${w.req[i]}`));
  assert.ok(k !== undefined, "prompt names a known step");
  w.calls[k]++;
  if (k === 0) { p.ctx.__orbitTaskQueue.add("other-1"); p.ctx.__orbitTaskQueue.add("other-2"); return { final: "Facts gathered from the notes: A, B, C." }; } // other work fills both slots
  if (k === 1 && !prompt.includes("YOUR STEPS SO FAR")) { w.proposals++; return { tool: "fake_write", input: { path: "report.md", text: "Report: A, B, C." } }; }
  if (k === 1) return { final: "Report drafted; the file write waits for approval." };
  return { final: "Checked: report.md matches the facts." };
}

const SRC: Record<string, string> = {};
const src = (f: string) => (SRC[f] ??= ts.transpileModule(readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

/** One ORBIT server process: agents.ts, chains.ts and missions.ts loaded fresh into one context (shared globalThis, like one Node process). */
function boot(w: World, missing = new Set<string>()) {
  const ctx: Row = { console, crypto, AbortController, AbortSignal, structuredClone, setTimeout: (f: () => void, ms: number) => setTimeout(f, Math.min(ms, 2)) };
  vm.createContext(ctx);
  const p = { ctx, agents: {} as Row, chains: {} as Row, missions: {} as Row };
  const budget = () => { const ac = new AbortController(); return { used: 0, calls: 20, minutes: 10, deadline: Date.now() + 600_000, signal: ac.signal }; };
  const claude = {
    MODEL: "stub", emit: async () => {}, recordUsage: async () => {}, createBudget: budget, chargeCall: (b: Row) => { b.used++; },
    stopKind: (_b: unknown, s: AbortSignal) => (s.aborted ? "cancelled" : null), stoppedReport: (m: string) => m, BudgetError: class extends Error {},
    reviewDraft: async (_t: string, d: string) => ({ text: d, reviewed: false }),
    askClaude: async (prompt: string) => {
      if (w.hang >= 0 && prompt.includes(`REQUEST:\n${w.req[w.hang]}`)) { w.calls[w.hang]++; w.hang = -1; return new Promise(() => {}); }
      return { text: JSON.stringify(model(w, p, prompt)), ms: 1 };
    },
  };
  const mods: Row = {
    "./claude": claude, "./authority": { authorizeAction: async () => ({ ok: true }) }, "./stop-all": stopAll, "./stop-all-pure": stopAllPure, "./completion-pure": completionPure, "./answer-call-pure": answerCallPure, "./task-claim-pure": taskClaimPure,
    "./company-pure": companyPure, "./chains-pure": chainsPure, "./missions-pure": missionsPure, "./durable": { noteWrite: () => {} }, "./pure": pure,
    "./memory": { KINDS: ["note"], createMemory: (_sb: unknown, userId: string, input: Row) => ctx.__memory({ ...input, user_id: userId }) }, "./core-ui": { needsSelfReview: () => false }, "./completion": { verifyRow: async () => {} },
    "./foreground-pure": foregroundPure, "./clip-store-pure": clipStorePure, "./memory-types-pure": memoryTypesPure, "./mission-checks-pure": missionChecksPure, "./research-pilot-pure": researchPilotPure, "./agent-defs-pure": agentDefsPure, "./model-log-pure": modelLogPure,
    "./capability": { capabilityStart: async () => ({ block: "", headsUp: "" }) },
    // the fake tool's destination is the workspace: a file receipt reads back what actually landed
    "./workspace": { readWsFile: async (_u: string, ref: string) => (w.dest.has(ref) ? { text: w.dest.get(ref), size: w.dest.get(ref)!.length } : null) },
    "./agents": p.agents, "./chains": p.chains, "./migration-guard": guard(missing),
  };
  for (const [f, out] of [["agents.ts", p.agents], ["chains.ts", p.chains], ["missions.ts", p.missions]] as const)
    vm.runInContext(`(function (exports, require) {${src(f)}\n})`, ctx)(out, (n: string) => mods[n] ?? (n === "./execution" ? execution : {}));
  // The fake tool: an approval-gated write with an observable counter. It honours the stable attempt id as its idempotency key.
  p.agents.TOOLS.fake_write = { description: "write a file", input: "{}", approval: true, run: async (c: Row, i: Row) => {
    const key = c.attempt ?? crypto.randomUUID();
    if (!w.dest.has(key)) { w.writes++; w.dest.set(key, String(i.text)); }
    c.evidence.push({ kind: "file", id: key, path: String(i.path) });
    if (w.crashNext) { w.crashNext = false; return new Promise(() => {}); } // the write landed, then the process died before the receipt
    return "Written and read back";
  } };
  p.agents.BUILTIN_AGENTS.find((a: Row) => a.slug === "nova").tools.push("fake_write");
  return p;
}
type Proc = ReturnType<typeof boot>;

async function scenario(req: string[], question: string, workers: 1 | 2) {
  const w = world(req); DBG = w;
  const { sb } = w;
  const task = (k: number) => w.tables.tasks.filter((t) => t.parent_id)[k];
  const mission = () => w.tables.missions[0];
  const idle = (ps: Proc[]) => ps.every((p) => !p.ctx.__orbitChains?.size);
  const tick = async (ps: Proc[]) => { await Promise.all(ps.map((p) => p.missions.resumeMissions(sb, "owner"))); await until(() => idle(ps), "drivers idle"); };

  // 1. Start via CORE's tool, as the owner's own instruction. Step 1 runs; meanwhile other work takes both slots.
  const A = boot(w);
  const out = await A.missions.runMissionTool(sb, "owner", "start_mission", { objective: "Report", acceptance: 'report.md contains "A, B, C"', steps: req.map((r) => ({ agent: "nova", request: r })) }, question, false);
  assert.match(out, /^Done: mission started/);
  await until(() => task(0)?.status === "done" && A.ctx.__orbitChains.size === 1, "step 1 done, driver waiting for a slot");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(task(1).status, "queued");

  // 2. Pause while step 2 waits for capacity, then capacity frees: step 2 must not start.
  const paused = await A.missions.actMission(sb, "owner", mission().id, "pause");
  assert.equal(paused.status, "paused");
  A.ctx.__orbitTaskQueue.clear();
  await until(() => idle([A]), "driver gave up after the pause");
  assert.equal(task(1).status, "queued");
  assert.equal(w.calls[1], 0, "no model call for step 2 while paused");

  // 3. Restart (fresh processes, same DB). A status read never drives. Resume: step 2 runs once, even with two workers contending.
  const B = Array.from({ length: workers }, () => boot(w));
  assert.equal((await B[0].missions.listMissions(sb, "owner"))[0].status, "paused");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(task(1).status, "queued", "a read doesn't start the step");
  for (const p of B) { p.ctx.__orbitTaskQueue.add("other-1"); p.ctx.__orbitTaskQueue.add("other-2"); } // both workers wait for capacity...
  const resumed = await B[0].missions.actMission(sb, "owner", mission().id, "resume");
  assert.equal(resumed.status, "running");
  await Promise.all(B.map((p) => p.missions.resumeMissions(sb, "owner")));
  await until(() => B.every((p) => p.ctx.__orbitChains.size === 1), "every worker is driving the chain");
  for (const p of B) p.ctx.__orbitTaskQueue.clear(); // ...and get it at the same moment: both see step 2 queued, only the claim decides
  if (workers > 1) await Promise.all(B.map((p) => p.agents.runTask(sb, "owner", task(1).id))); // plus each worker picking the item up directly
  await until(() => task(1).status === "awaiting_approval" && idle(B), "step 2 waits for approval");
  assert.equal(w.proposals, 1, "step 2 executed exactly once");
  await tick(B);
  assert.equal(mission().status, "waiting-approval");

  // 4. Owner approves (twice, if two workers); the write lands and the process dies before the receipt is saved.
  w.crashNext = true;
  const approvals = B.map((p) => p.agents.resolvePending(sb, "owner", task(1).id, true));
  const losers = await Promise.allSettled(approvals.slice(1));
  for (const l of losers) assert.match(String((l as PromiseRejectedResult).reason), /already being handled/);
  await until(() => w.writes === 1, "write landed");
  assert.equal(task(1).pending[0].status, "attempting");

  // 5. Restart after the lease runs out. Recovery: uncertain, never re-run, mission needs the owner.
  task(1).started_at = new Date(Date.now() - 21 * 60_000).toISOString();
  const C = Array.from({ length: workers }, () => boot(w));
  await tick(C);
  await tick(C);
  assert.equal(task(1).status, "failed");
  assert.equal(task(1).pending[0].status, "uncertain");
  assert.match(task(1).pending[0].note, /Needs inspection/);
  assert.equal(mission().status, "waiting-input");
  assert.equal(mission().doc.blocker && /check its result before retrying/.test(mission().doc.blocker), true);
  const view = (await C[0].missions.listMissions(sb, "owner"))[0];
  assert.equal(view.label, "Needs you");
  await assert.rejects(() => C[0].agents.resolvePending(sb, "owner", task(1).id, true), /Nothing is waiting/);
  await tick(C);
  assert.equal(w.writes, 1);
  assert.equal(w.proposals, 1, "no automatic retry");

  // 6. Owner inspects (the write is at the destination under the attempt id), then continues: retry step 2 and approve again.
  const attempt = task(1).pending[0].attempt;
  assert.equal(w.dest.get(attempt), "Report: A, B, C.");
  const retried = await C[0].missions.actMission(sb, "owner", mission().id, "retry");
  assert.ok(!("error" in retried), JSON.stringify(retried));
  await until(() => task(1).status === "awaiting_approval" && idle(C), "step 2 re-proposed");
  await C[C.length - 1].agents.resolvePending(sb, "owner", task(1).id, true);
  assert.equal(task(1).status, "done");
  assert.equal(task(1).pending[0].attempt, attempt, "same stable id on the retried action");
  assert.equal(w.writes, 1, "no duplicate write");

  // 7. Finish: step 3, then the mission completes. Final artifact, receipts and history.
  for (let i = 0; i < 5 && mission().status !== "completed"; i++) await tick(C);
  assert.equal(mission().status, "completed");
  assert.equal(mission().doc.verified, true, JSON.stringify(mission().doc.checks)); // the acceptance check reads the file that actually landed
  const chain = w.tables.tasks.find((t) => !t.parent_id)!;
  assert.equal(chain.status, "done");
  assert.equal(chain.result, "Checked: report.md matches the facts.");
  assert.deepEqual([...w.dest.values()], ["Report: A, B, C."]);
  assert.deepEqual(w.calls.map((c) => c > 0), [true, true, true]);
  assert.equal(w.calls[0], 1, "step 1 never reran");
  const r = mission().doc.receipts;
  assert.deepEqual(w.tables.tasks.filter((t) => t.parent_id).map((t) => t.status), ["done", "done", "done"]);
  assert.deepEqual(r.map((x: Row) => [x.kind, x.ref, x.step, x.path]), [["file", attempt, 1, "report.md"]], "receipts: only the checked write (a finished step is not a receipt)");
  const log = mission().doc.log.map((l: Row) => l.text).join("\n");
  for (const s of [/pause/i, /resum|running/i, /check its result before retrying/, /receipt/, /Verified/, /complete/i]) assert.match(log, s);
  assert.match(mission().doc.decisions.map((d: Row) => d.text).join("\n"), /retry step 2/);
  return w;
}

const EN = ["Gather the facts for the report.", "Write the report file.", "Check the report against the facts."];
const ET = ["Kogu aruande jaoks faktid.", "Kirjuta aruande fail.", "Kontrolli aruannet faktide vastu."];

test("mission gate: start, pause while waiting for a slot, restart, resume, crash mid-write, recover, finish", { timeout: 30_000 }, async () => {
  await scenario(EN, "Gather the facts, then write the report file, then check it.", 1);
});

test("mission gate with two workers contending for the same work", { timeout: 30_000 }, async () => {
  await scenario(EN, "Gather the facts, then write the report file, then check it.", 2);
});

test("mission gate with the request in Estonian (CORE routing keeps MISSIONS)", { timeout: 30_000 }, async () => {
  const q = "Kogu faktid, siis kirjuta aruande fail ja kontrolli see üle.";
  const specs = [{ name: "MISSIONS", prompt: "", tools: ["mission_status", "start_mission"] }, ...Object.keys(MODULE_HINTS).map((name) => ({ name, prompt: "", tools: [] }))];
  const picked = selectModules(specs, q).map((m) => m.name);
  assert.ok(picked.includes("MISSIONS"), "start_mission is offered for an Estonian request");
  assert.ok(picked.includes("WORKSPACE") && picked.includes("LIFE"), `Estonian hints route too: ${picked}`); // "kirjuta … fail"
  assert.equal(missionsPure.missionBlocked(q, false), "");
  await scenario(ET, q, 2);
});

test("approved write tools are idempotent on the attempt id: same attempt twice → one row, the receipt found again", async () => {
  for (const noCol of [false, true]) {
    const w = world(EN);
    if (noCol) Object.assign(w, fakeDb(true));
    const p = boot(w);
    p.ctx.__memory = (row: Row) => w.sb.from("memories").insert(row).select("id").single().then((r: Row) => ({ memory: r.data }));
    const cases: [string, string, Row][] = [
      ["save_memory", "memories", { title: "T", content: "C", kind: "note", tags: ["x"] }],
      ["create_project", "projects", { name: "P", description: "D" }],
      ["add_task", "tasks", { title: "T", request: "R", agent: "nova" }],
      ["propose_automation", "automations", { name: "A", trigger: "event", event: "briefing.ready", agent: "nova", prompt: "Do it" }],
    ];
    for (const [tool, table, input] of cases) {
      const run = async (attempt: string) => { const c: Row = { sb: w.sb, userId: "owner", task: { agent: "nova", title: "t", project_id: null }, evidence: [], attempt }; const note = await p.agents.TOOLS[tool].run(c, input); return { note, id: c.evidence[0]?.id }; };
      if (noCol && table !== "memories") { // without migration 0023: refused with the exact file, nothing written
        const before = (w.tables[table] ?? []).length;
        await assert.rejects(run("t1:0"), (e: Error) => e.message === blockedMsg("0023"), tool);
        assert.equal((w.tables[table] ?? []).length, before, `${tool}: nothing written`);
        continue;
      }
      const a = await run("t1:0"), b = await run("t1:0"), other = await run("t2:0");
      const rows = w.tables[table].filter((r) => r.user_id === "owner").length;
      assert.ok(a.id, `${tool}: ${a.note}`);
      assert.equal(rows, 2, `${tool}: one effect per attempt`);
      assert.equal(b.id, a.id, `${tool}: the rerun returns the original receipt`);
      assert.match(b.note, /Already done/);
      assert.notEqual(other.id, a.id);
    }
  }
});

test("chain with 0021 missing: the drive stops, the step stays queued (not failed), the chain isn't failed", async () => {
  const w = world(EN);
  const A = boot(w, new Set(["0021"]));
  const out = await A.missions.runMissionTool(w.sb, "owner", "start_mission", { objective: "Report", acceptance: 'report.md contains "A, B, C"', steps: EN.map((r) => ({ agent: "nova", request: r })) }, "start a mission", false);
  assert.match(out, /^Done: mission started/);
  await until(() => !A.ctx.__orbitChains?.size, "driver stopped");
  const steps = w.tables.tasks.filter((t) => t.parent_id);
  assert.equal(steps[0].status, "queued");
  assert.equal(w.tables.tasks.find((t) => !t.parent_id)!.status, "running");
  assert.equal(w.calls[0], 0, "no model call");
});

// OPS08/G19: the scheduler is the only host. No UI read (GET /api/chains → listChains/getChain) ever drives; scheduler ticks
// (resumeChains, exactly what scheduler.ts calls) alone take a team chain through an approval to the end, and a restart mid-step
// ends in an explicit interrupted state with no second model call or effect.
test("chain runs to the end from scheduler ticks alone; reads never drive; restart mid-step → interrupted, no duplicate", { timeout: 30_000 }, async () => {
  const run = async (restart: boolean) => {
    const w = world(EN); DBG = w;
    const { sb } = w;
    const steps = () => w.tables.tasks.filter((t) => t.parent_id), chain = () => w.tables.tasks.find((t) => !t.parent_id)!;
    const A = boot(w);
    const c = await A.chains.createChain(sb, "owner", { goal: "Report", steps: EN.map((r) => ({ agent: "nova", request: r })) }, undefined, false);
    assert.ok(c.chainId, JSON.stringify(c));
    const tick = async (p: Proc) => { await p.chains.resumeChains(sb, "owner"); await until(() => { p.ctx.__orbitTaskQueue?.delete("other-1"); p.ctx.__orbitTaskQueue?.delete("other-2"); return !p.ctx.__orbitChains?.size; }, "driver idle"); }; // step 1's model fills both slots: free them
    // A UI read alone: nothing moves.
    await A.chains.listChains(sb, "owner"); await A.chains.getChain(sb, "owner", c.chainId);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(steps()[0].status, "queued", "a read never starts a step");
    assert.equal(w.calls[0], 0);
    await tick(A); // step 1, then step 2 proposes its write and waits
    assert.deepEqual(steps().map((t) => t.status), ["done", "awaiting_approval", "queued"]);
    await A.agents.resolvePending(sb, "owner", steps()[1].id, true); // the owner's click (an action, not a read)
    assert.equal(w.writes, 1);
    if (!restart) {
      await tick(A);
      assert.equal(chain().status, "done");
      assert.deepEqual(w.calls, [1, 2, 1]);
      return;
    }
    w.hang = 2; // step 3 starts, then the process dies mid-step
    void A.chains.resumeChains(sb, "owner");
    await until(() => { A.ctx.__orbitTaskQueue?.delete("other-1"); A.ctx.__orbitTaskQueue?.delete("other-2"); return steps()[2].status === "running" && w.calls[2] === 1; }, "step 3 mid-flight");
    const B = boot(w); // restart: fresh process, same DB
    await tick(B);
    assert.equal(steps()[2].status, "running", "inside the lease: not re-run, not touched");
    assert.equal(w.calls[2], 1);
    steps()[2].started_at = new Date(Date.now() - 21 * 60_000).toISOString(); // the lease runs out
    await tick(B);
    assert.equal(steps()[2].status, "failed");
    assert.match(steps()[2].error, /Interrupted \(ORBIT restarted\)/);
    assert.equal(chain().status, "failed", "the chain ends explicitly, never shown running forever");
    assert.match(chain().error, /Step 3/);
    await tick(B);
    assert.equal(w.calls[2], 1, "no automatic re-run");
    assert.equal(w.writes, 1, "no duplicate effect");
  };
  await run(false);
  await run(true);
});
