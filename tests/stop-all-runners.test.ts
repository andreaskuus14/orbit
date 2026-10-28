// Stop-all at each runner boundary, with fakes: the durable flag across processes, an agent task mid-run,
// an approval under Stop-all, and a chain step waiting for a free slot. Semantics: docs/STOP-ALL.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as completionPure from "../src/lib/completion-pure.ts";
import * as clipStorePure from "../src/lib/clip-store-pure.ts";
import * as pure from "../src/lib/pure.ts";
import * as claim from "../src/lib/task-claim-pure.ts";
import { PAUSED_MSG } from "../src/lib/stop-all-pure.ts";

test("the flag is durable and shared: another process's toggle is seen without a restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-stop-x-"));
  process.env.ORBIT_DATA_DIR = dir;
  const m = await import("../src/lib/stop-all.ts");
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll;
  assert.equal(m.stopAllOn(), false); // cached "off" in this process
  const other = (on: boolean) => execFileSync(process.execPath, ["--input-type=module", "-e",
    `const m = await import(${JSON.stringify(new URL("../src/lib/stop-all.ts", import.meta.url).href)}); await m.setStopAll(${on});`],
    { env: { ...process.env, ORBIT_DATA_DIR: dir } });
  other(true);
  assert.equal(m.stopAllOn(), true); // second process turned it on
  other(false);
  assert.equal(m.stopAllOn(), false); // ...and off
  await m.setStopAll(true);
  assert.equal(m.stopAllOn(), true); // own toggle still wins at once
  await m.setStopAll(false);
  delete process.env.ORBIT_DATA_DIR;
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll;
});

// Load a real module as CommonJS, replacing its imports with fakes (no server, no Claude call).
function load(file: string, deps: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  const src = ts.transpileModule(readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(src, { exports, require: (n: string) => deps[n] ?? {}, console, crypto, AbortController, AbortSignal, DOMException, setTimeout, ...globals });
  return exports;
}

function fakeDb(rows: Record<string, unknown>[]) {
  const db = rows.map((r) => structuredClone(r));
  const sb = { from() {
    const f: ((r: Record<string, unknown>) => boolean)[] = []; let patch: object | null = null;
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q,
      eq: (k: string, v: unknown) => (f.push((r) => r[k] === v), q), neq: (k: string, v: unknown) => (f.push((r) => r[k] !== v), q),
      is: (k: string, v: unknown) => (f.push((r) => (r[k] ?? null) === v), q), in: (k: string, v: unknown[]) => (f.push((r) => v.includes(r[k])), q),
      or: () => (f.push((r) => r.status === "queued" || r.status === "running"), q),
      update: (v: object) => ((patch = v), q),
      exec(one = false) {
        const m = db.filter((r) => f.every((p) => p(r)));
        if (patch) for (const r of m) Object.assign(r, structuredClone(patch));
        return { data: one ? m[0] ?? null : structuredClone(m), error: null };
      },
      single: () => Promise.resolve(q.exec(true)), maybeSingle: () => Promise.resolve(q.exec(true)),
      then: (ok: any, bad: any) => Promise.resolve(q.exec()).then(ok, bad),
    };
    return q;
  } };
  return { sb, db };
}

function agentsWith(stop: { on: boolean }, askClaude: (...a: unknown[]) => Promise<unknown>) {
  return load("agents.ts", {
    "./stop-all": { stopAllOn: () => stop.on }, "./stop-all-pure": { PAUSED_MSG }, "./completion-pure": completionPure, "./clip-store-pure": clipStorePure,
    "./task-claim-pure": claim, "./pure": pure, "./memory": { KINDS: ["note"] },
    "./claude": { askClaude, emit: async () => {}, recordUsage: async () => {}, chargeCall: (_b: unknown, s: AbortSignal) => s.throwIfAborted(),
      createBudget: () => ({ signal: new AbortController().signal, calls: 12, used: 0, minutes: 8, deadline: Date.now() + 1e6 }),
      stopKind: (_b: unknown, s: AbortSignal) => (s.aborted ? "cancelled" : null), stoppedReport: (h: string) => h, BudgetError: class extends Error {} },
  });
}
const row = (id: string, status: string, pending: unknown[] = []) => ({ id, user_id: "owner", parent_id: null, project_id: null, status, agent: "nova", title: id, request: "r", pending });

test("agent task: Stop-all set during a model call (any process) stops it before the tool runs", async () => {
  const stop = { on: false };
  let ran = 0;
  const a = agentsWith(stop, async () => { stop.on = true; return { text: JSON.stringify({ tool: "save_memory", input: {} }), ms: 1 }; });
  a.TOOLS.save_memory.approval = false;
  a.TOOLS.save_memory.run = async () => { ran++; return "saved"; };
  const { sb, db } = fakeDb([row("t1", "queued")]);
  const r = await a.runTask(sb, "owner", "t1");
  assert.equal(ran, 0);
  assert.equal(r.status, "cancelled");
  assert.equal(db[0].status, "cancelled");
});

test("agent task: Stop-all already on never starts it", async () => {
  let asked = 0;
  const a = agentsWith({ on: true }, async () => { asked++; return { text: "{}" }; });
  const { sb, db } = fakeDb([row("t2", "queued")]);
  assert.equal((await a.runTask(sb, "owner", "t2")).error, PAUSED_MSG);
  assert.equal(asked, 0);
  assert.equal(db[0].status, "cancelled");
});

test("approval under Stop-all: approve is refused and nothing runs; the item keeps waiting; reject still works", async () => {
  const stop = { on: true };
  const a = agentsWith(stop, async () => ({}));
  let ran = 0;
  a.TOOLS.save_memory.run = async () => { ran++; return "saved"; };
  const { sb, db } = fakeDb([row("t3", "awaiting_approval", [{ tool: "save_memory", input: {}, status: "pending" }])]);
  await assert.rejects(() => a.resolvePending(sb, "owner", "t3", true), new RegExp(PAUSED_MSG.replace(/[()]/g, "\\$&")));
  assert.equal(ran, 0);
  assert.equal(db[0].status, "awaiting_approval");
  stop.on = false; // after Resume the same approval runs exactly once
  await a.resolvePending(sb, "owner", "t3", true);
  await assert.rejects(() => a.resolvePending(sb, "owner", "t3", true), /Nothing is waiting/);
  assert.equal(ran, 1);
});

test("chain step waiting for capacity: Stop-all meanwhile means it never starts (stays queued for Resume)", async () => {
  const stop = { on: false };
  const slots = new Set(["a", "b"]); // both agent slots busy
  let ran = 0, kicked = 0;
  const c = load("chains.ts", { "./stop-all": { stopAllOn: () => stop.on }, "./agents": { kickQueue: async () => { kicked++; } } },
    { __orbitTaskQueue: slots, setTimeout: (r: () => void) => { stop.on = true; slots.clear(); r(); } }); // the wait ends with a free slot, but Stop-all is now on
  const ok = await c.withSlot({}, "owner", "step", new AbortController().signal, async () => { ran++; });
  assert.equal(ok, false);
  assert.equal(ran, 0);
  assert.equal(slots.size, 0);
  assert.equal(kicked, 0);
});

test("scheduled publishing: Stop-all while waiting for another upload means ours never starts", async () => {
  const stop = { on: false };
  let started = 0;
  const clip = { id: "c1", status: "approved", title: "t" };
  const job = { id: "j1", clips: [clip] };
  const p = load("clips/publish-schedule.ts", {
    "../stop-all": { stopAllOn: () => stop.on }, "../stop-all-pure": { PAUSED_MSG }, "../autonomy": { allows: () => ({ ok: true }) },
    "./publish-checks-pure": { originalityIssue: () => "" }, "../yt-analytics-pure": { videoResource: () => ({}) },
    "./schedule": { DEFAULT_PUBLISH: {}, nextSlots: () => ["2026-11-01T10:00:00Z"], parseSettings: () => ({}), usedSlots: () => [] },
    "node:fs/promises": { stat: async () => ({ isFile: () => true }) }, "node:path": path,
    "./factory": { listJobs: async () => [job], getJob: async () => job, isPublishing: () => false, clipFile: () => "/x.mp4",
      publishDone: async () => { stop.on = true; }, // the upload we waited for finished; Stop-all came on meanwhile
      withJobLock: (fn: () => unknown) => fn(), startPublish: async () => { started++; }, readState: async () => null, studioRoot: () => "/s" },
  }, { Promise });
  const batch = await p.scheduleAll();
  while (batch.running) await new Promise((r) => setImmediate(r));
  assert.equal(started, 0);
  assert.equal(batch.error, PAUSED_MSG);
});
