import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedMsg, migrationNeed } from "../src/lib/version-pure.ts";
import { MigrationBlocked, missingGuarded, probeMarkers, refuse, requireMigration } from "../src/lib/migration-guard.ts";

// Fake Supabase: a head select of table.column fails with 42703 when that column is in `gone`.
const db = (gone: Set<string>, calls = { n: 0 }) => ({ from: (table: string) => ({ select: (col: string) => ({ limit: () => ({ abortSignal: async () => {
  calls.n++;
  return gone.has(`${table}.${col}`) ? { error: { code: "42703", message: `column ${table}.${col} does not exist` } } : { error: null };
} }) }) }) }) as never;
const reset = () => { (globalThis as { __orbitMigGuard?: unknown }).__orbitMigGuard = undefined; };

test("each guarded migration refuses with its exact message when its column is missing, and passes when present", async () => {
  const cols = { "0021": "tasks.claimed_by", "0022": "proposals.basis", "0023": "tasks.attempt_id" } as const;
  for (const [id, col] of Object.entries(cols) as [keyof typeof cols, string][]) {
    reset();
    await assert.rejects(requireMigration(db(new Set([col])), id), (e: Error) => e instanceof MigrationBlocked && e.message === blockedMsg(id));
    reset();
    await requireMigration(db(new Set()), id);
  }
  assert.equal(blockedMsg("0021"), "ORBIT needs database update 0021_task_claim before it can run agent tasks safely — open Doctor → Database migrations");
});

test("one cached probe; refuse() drops the cache so the next check re-probes (unblocks once applied)", async () => {
  reset();
  const calls = { n: 0 };
  const sb = db(new Set(["tasks.claimed_by"]), calls);
  assert.deepEqual(await missingGuarded(sb), ["0021"]);
  await assert.rejects(requireMigration(sb, "0021"));
  assert.equal(calls.n, 3); // three markers, probed once
  assert.equal(refuse("0021").message, blockedMsg("0021"));
  assert.deepEqual(await missingGuarded(db(new Set())), []); // re-probed: applied now
  reset();
});

test("probe: unknown errors are 'couldn't tell', not missing; Needs-you names the oldest missing", async () => {
  const flaky = { from: () => ({ select: () => ({ limit: () => ({ abortSignal: async () => ({ error: { code: "57014", message: "timeout" } }) }) }) }) } as never;
  assert.deepEqual(await probeMarkers(flaky, ["0021"]), {});
  assert.equal(migrationNeed([]), null);
  assert.deepEqual(migrationNeed(["0023", "0021"]), { id: "migrations:0021,0023", title: blockedMsg("0021") });
});

// The real guarded call sites, loaded as CommonJS with fakes for their imports (no server).
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as claimPure from "../src/lib/task-claim-pure.ts";
import * as revPure from "../src/lib/artifact-rev-pure.ts";
import * as proactivePure from "../src/lib/proactive-pure.ts";
import * as completionPure from "../src/lib/completion-pure.ts";
import * as clipStorePure from "../src/lib/clip-store-pure.ts";
import * as pure from "../src/lib/pure.ts";
import * as execution from "../src/lib/execution.ts"; // the real execution-evidence module agents.ts uses
const stub = (missing: string[]) => ({ MigrationBlocked, requireMigration: async (_sb: unknown, id: "0021" | "0022" | "0023") => { if (missing.includes(id)) throw new MigrationBlocked(blockedMsg(id)); }, refuse: (id: "0021") => new MigrationBlocked(blockedMsg(id)) });
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const src = ts.transpileModule(readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(src, { exports, require: (n: string) => deps[n] ?? (n === "./execution" ? execution : {}), console: { ...console, error: () => {} }, crypto, AbortController, AbortSignal, setTimeout });
  return exports;
}
function rowsDb(tables: Record<string, Record<string, unknown>[]>) {
  return { from(t: string) {
    const f: ((r: Record<string, unknown>) => boolean)[] = []; let patch: object | null = null, ins: Record<string, unknown> | null = null;
    const q: any = {
      select: () => q, order: () => q, limit: () => q, or: () => q,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), q), is: (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), q),
      in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), q),
      update: (v: object) => ((patch = v), q), insert: (v: Record<string, unknown>) => ((ins = { id: `n${tables[t].length}`, ...v }), q),
      exec(one = false) {
        if (ins) { tables[t].push(ins); return { data: ins, error: null }; }
        const m = tables[t].filter((r) => f.every((p) => p(r)));
        if (patch) for (const r of m) Object.assign(r, patch);
        return { data: one ? m[0] ?? null : m, error: null };
      },
      single: () => Promise.resolve(q.exec(true)), maybeSingle: () => Promise.resolve(q.exec(true)),
      then: (ok: any, bad: any) => Promise.resolve(q.exec()).then(ok, bad),
    };
    return q;
  } };
}

test("task claiming refuses while 0021 is missing: the task stays queued (not failed)", async () => {
  const tasks = [{ id: "t1", user_id: "owner", status: "queued", parent_id: null }];
  const a = load("agents.ts", { "./task-claim-pure": claimPure, "./completion-pure": completionPure, "./clip-store-pure": clipStorePure, "./pure": pure, "./memory": { KINDS: ["note"] }, "./claude": { createBudget: () => ({ signal: new AbortController().signal }) }, "./stop-all": { stopAllOn: () => false }, "./migration-guard": stub(["0021"]) });
  await a.kickQueue(rowsDb({ tasks }), "owner");
  assert.equal(tasks[0].status, "queued");
  const r = await a.runTask(rowsDb({ tasks }), "owner", "t1");
  assert.equal(r.status, "blocked");
  assert.equal(r.error, blockedMsg("0021"));
  assert.equal(tasks[0].status, "queued");
});

test("proposal approval refuses while 0022 is missing (stays pending) and approves once applied", async () => {
  const make = (missing: string[]) => {
    const tables = { proposals: [{ id: "p1", user_id: "owner", status: "pending", agent: "nova", title: "T", prompt: "P", why: "W", basis: [] }], tasks: [] as Record<string, unknown>[] };
    const p = load("proactive.ts", { "./artifact-rev-pure": revPure, "./proactive-pure": proactivePure, "./migration-guard": stub(missing),
      "./agents": { getAgent: async () => ({ slug: "nova" }), kickQueue: async () => {} }, "./stop-all": { stopAllOn: () => false } });
    return { p, tables, sb: rowsDb(tables) };
  };
  const blocked = make(["0022"]);
  await assert.rejects(blocked.p.approveProposal(blocked.sb, "owner", "p1"), (e: Error) => e.message === blockedMsg("0022"));
  assert.equal(blocked.tables.proposals[0].status, "pending");
  const ok = make([]);
  await ok.p.approveProposal(ok.sb, "owner", "p1");
  assert.equal(ok.tables.proposals[0].status, "approved");
  assert.equal(ok.tables.tasks.length, 1);
});

test("night: research, goal and company items are deferred with the message while 0021 is missing", async () => {
  const touched: string[] = [];
  const n = load("night.ts", { "./migration-guard": stub(["0021"]),
    "./goals": new Proxy({}, { get: (_t, k) => { touched.push(`goals.${String(k)}`); return undefined; } }),
    "./chains": new Proxy({}, { get: (_t, k) => { touched.push(`chains.${String(k)}`); return undefined; } }) });
  for (const kind of ["research", "goal", "company"]) {
    const r = await n.runOne(rowsDb({ tasks: [] }), "owner", { kind, ref: "x:1", label: "L" }, new AbortController().signal);
    assert.equal(r.status, "failed", kind);
    assert.equal(r.why, blockedMsg("0021"), kind);
  }
  assert.deepEqual(touched.filter((k) => !k.endsWith("then")), [], "no goal advanced, no chain driven");
});
