// A scheduled automation starts once per due slot, even when its last_run_at write is lost (failed update, or a crash
// between the task insert and that write). Reproduced on the isolated stack: 4 tasks in 4 ticks before this fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/automations.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function engine(opts: { loseUpdate?: boolean; tasks?: any[]; autos?: any[] } = {}) {
  const now = new Date("2026-11-07T17:45:00Z");
  const autos: any[] = opts.autos ?? [{ id: "a1", user_id: "u1", name: "Hourly digest", enabled: true, trigger: "schedule", schedule: { every: "hour", minute: 40 },
    event: null, kind_filter: null, agent: "nova", prompt: "Summarise", last_run_at: null, run_count: 0, created_at: "2026-11-01T00:00:00Z" }];
  const tasks: any[] = opts.tasks ?? [];
  class Q {
    filters: [string, string, any][] = []; patch: any = null; row: any = null; table: string;
    constructor(table: string) { this.table = table; }
    select() { return this; } limit() { return this; }
    eq(k: string, v: any) { this.filters.push(["eq", k, v]); return this; }
    like(k: string, v: string) { this.filters.push(["like", k, v]); return this; }
    insert(r: any) { this.row = r; return this; }
    update(p: any) { this.patch = p; return this; }
    match(r: any) { return this.filters.every(([op, k, v]) => op === "eq" ? r[k] === v : String(r[k]).endsWith(v.replace(/^%/, ""))); }
    async single() {
      await Promise.resolve(); // a network round trip: another ORBIT's tick can interleave here
      if (this.row.attempt_id && tasks.some((t) => t.user_id === this.row.user_id && t.attempt_id === this.row.attempt_id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"tasks_attempt\"" } };
      const r = { id: `t${tasks.length + 1}`, ...this.row }; tasks.push(r); return { data: { id: r.id }, error: null };
    }
    then(res: any, rej: any) {
      const rows = this.table === "tasks" ? tasks : autos;
      const hits = rows.filter((r) => this.match(r));
      if (this.patch && !opts.loseUpdate) for (const r of hits) Object.assign(r, this.patch);
      return Promise.resolve({ data: clone(hits), error: this.patch && opts.loseUpdate ? { message: "update lost" } : null }).then(res, rej);
    }
  }
  const sb = { from: (t: string) => new Q(t) }, m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, console: { log() {}, error() {} }, Date, Promise, Error, JSON, String,
    require: (n: string) => n.endsWith("/pure") ? pure : n.endsWith("/agents") ? { kickQueue: () => {} } : n.endsWith("/durable") ? {}
      : n.endsWith("/stop-all") ? { stopAllOn: () => false } : n.endsWith("/authority") ? { authorizeAction: async () => ({ ok: true }) }
      : n.endsWith("/stop-all-pure") ? { PAUSED_MSG: "paused" } : {},
  });
  const tick = (minutes = 0) => m.exports.runDueAutomations(sb, "u1", new Date(now.getTime() + minutes * 60_000));
  return { tick, autos, tasks };
}

test("lost last_run_at write: four ticks of one due slot start exactly one task", async () => {
  const e = engine({ loseUpdate: true });
  for (let i = 0; i < 4; i++) await e.tick(i);
  assert.equal(e.tasks.length, 1);
  assert.match(e.tasks[0].request, /\[schedule:a1:2026-11-07T17:40:00\.000Z\]$/);
});

test("normal run: one task, last_run_at saved, counter +1, not due again in the same slot", async () => {
  const e = engine();
  for (let i = 0; i < 3; i++) await e.tick(i);
  assert.equal(e.tasks.length, 1); assert.equal(e.autos[0].run_count, 1); assert.ok(e.autos[0].last_run_at);
});

test("a write lost then recovered: the existing task is found, last_run_at is re-marked, nothing new starts", async () => {
  const e = engine({ loseUpdate: true });
  await e.tick(0);
  const lost = engine(); // same slot, now with a working update: reuse the first engine's task by copying it in
  lost.tasks.push(...e.tasks);
  await lost.tick(1);
  assert.equal(lost.tasks.length, 1); assert.ok(lost.autos[0].last_run_at); assert.equal(lost.autos[0].run_count, 0);
});

test("the next hourly slot is a new run", async () => {
  const e = engine({ loseUpdate: true });
  await e.tick(0); await e.tick(60);
  assert.equal(e.tasks.length, 2);
});

test("two ORBITs on one database tick the same slot at once: one task, the other finds it (unique attempt_id)", async () => {
  const shared: any[] = [], a = engine({ tasks: shared }), b = engine({ tasks: shared, autos: a.autos });
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(shared.length, 1, JSON.stringify(shared.map((t) => t.attempt_id)));
  assert.match(shared[0].attempt_id, /^slot:a1:/);
  await Promise.all([a.tick(1), b.tick(1)]); // same slot again a minute later: still one
  assert.equal(shared.length, 1);
});
