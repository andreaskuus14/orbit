import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/pure.ts";
import * as edit from "../src/lib/automation-edit-pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/app/api/automations/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const row = (id = "one", owner = "owner") => ({ id, user_id: owner, name: "Old name", agent: "forge", prompt: "Write a summary", enabled: false,
  trigger: "schedule", schedule: { every: "day", hour: 9, minute: 0 }, event: null, kind_filter: null, run_count: 7, last_run_at: "yesterday", created_at: "last-week" });
const clone = (x: any) => JSON.parse(JSON.stringify(x));
function api(options: { authorized?: boolean; readError?: boolean; writeError?: boolean; runnerError?: boolean; deleteBeforeWrite?: boolean } = {}) {
  const rows: any[] = [row(), row("other", "another-owner")], writes: any[] = [], runs: any[] = [], lookups: any[] = [], queries: any[] = [];
  class Query {
    filters: [string, any][] = []; patch: any = null;
    constructor() { queries.push(this); }
    select() { return this; }
    eq(k: string, v: any) { this.filters.push([k, v]); return this; }
    update(patch: any) { this.patch = patch; return this; }
    async maybeSingle() { return { data: clone(rows.find((r) => this.filters.every(([k, v]) => r[k] === v)) ?? null), error: options.readError ? { message: "read failed" } : null }; }
    then(resolve: any, reject: any) {
      const matches = rows.filter((r) => this.filters.every(([k, v]) => r[k] === v));
      if (this.patch && !options.writeError) for (const r of matches) { writes.push(clone(this.patch)); Object.assign(r, this.patch); }
      return Promise.resolve({ data: matches.map((r) => ({ id: r.id })), error: options.writeError ? { message: "write failed" } : null }).then(resolve, reject);
    }
  }
  const sb = { from: () => new Query() }, m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, URL, Error,
    require: (name: string) => name.endsWith("automation-edit-pure") ? edit : name.endsWith("/pure") ? pure : name.endsWith("supabase/server") ? {
      requireUser: async () => options.authorized === false ? { res: new Response("Unauthorized", { status: 401 }) } : { sb, user: { id: "owner" } },
    } : name.endsWith("/agents") ? {
      getAgent: async (_sb: any, slug: string, owner: string) => { lookups.push({ slug, owner }); if (options.deleteBeforeWrite) rows.splice(0, 1); return ["forge", "nova", "pulse", "my-agent"].includes(slug) ? { slug } : null; },
    } : { startAutomation: async (_sb: any, a: any, why: string) => { if (options.runnerError) throw new Error("Stop-all is on"); runs.push({ a, why }); return "new-task"; } },
  });
  const request = (method: string, body: unknown) => m.exports[method](new Request("http://localhost/api/automations", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { request, rows, writes, runs, lookups, queries };
}

test("PATCH edits name, agent, instructions and schedule while preserving pause state and counters", async () => {
  const a = api();
  const r = await a.request("PATCH", { id: "one", name: " Updated ", agent: "pulse", prompt: "Find the latest news", schedule: { hour: 17, minute: 15 } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(a.rows[0].name, "Updated"); assert.equal(a.rows[0].agent, "pulse"); assert.equal(a.rows[0].enabled, false);
  assert.equal(a.rows[0].run_count, 7); assert.equal(a.rows[0].last_run_at, "yesterday");
  assert.deepEqual(a.rows[0].schedule, { every: "day", hour: 17, minute: 15 });
  assert.deepEqual(a.lookups, [{ slug: "pulse", owner: "owner" }]);
  assert.equal(a.rows[1].name, "Old name"); assert.equal(a.runs.length, 0);
  for (const q of a.queries) assert.ok(q.filters.some(([k, v]: any) => k === "user_id" && v === "owner"));
});
test("enabled-only PATCH still works and does not validate/replace a legacy missing agent", async () => {
  const a = api(); a.rows[0].agent = "deleted-agent";
  const before = clone(a.rows[0]);
  assert.equal((await a.request("PATCH", { id: "one", enabled: true })).status, 200);
  assert.deepEqual(a.rows[0], { ...before, enabled: true }); assert.deepEqual(a.writes, [{ enabled: true }]); assert.equal(a.lookups.length, 0);
});
test("PATCH rejects unknown or unavailable agents, including another owner's custom agent", async () => {
  for (const slug of ["missing", "disabled-agent", "other-owner-agent"]) {
    const a = api(); assert.equal((await a.request("PATCH", { id: "one", agent: slug })).status, 400); assert.equal(a.writes.length, 0);
    assert.deepEqual(a.lookups, [{ slug, owner: "owner" }]);
  }
});
test("editing other fields also validates the resulting agent before writing", async () => {
  const a = api(); a.rows[0].agent = "deleted-agent";
  assert.equal((await a.request("PATCH", { id: "one", name: "Rename" })).status, 400); assert.equal(a.writes.length, 0);
});
test("schedule to memory event and then briefing event clears incompatible fields", async () => {
  const a = api();
  assert.equal((await a.request("PATCH", { id: "one", trigger: "event", event: "memory.created", schedule: null, kind_filter: "document" })).status, 200);
  assert.equal(a.rows[0].schedule, null); assert.equal(a.rows[0].kind_filter, "document");
  assert.equal((await a.request("PATCH", { id: "one", event: "briefing.ready" })).status, 200); assert.equal(a.rows[0].kind_filter, null);
});
test("invalid editable fields and attempts to write metadata never reach update", async () => {
  for (const body of [{ name: "" }, { prompt: "no" }, { agent: "Bad Agent" }, { schedule: { minute: 60 } }, { trigger: "invalid" }, { event: "invalid" }, { kind_filter: "Bad Kind" }, { enabled: "yes" }, { user_id: "other" }, { run_count: 0 }, {}]) {
    const a = api(); assert.equal((await a.request("PATCH", { id: "one", ...body })).status, 400); assert.equal(a.writes.length, 0); assert.equal(a.runs.length, 0);
  }
});
test("PATCH and Run now require authentication and cannot read/update/run another owner's row", async () => {
  const denied = api({ authorized: false });
  assert.equal((await denied.request("PATCH", { id: "one", enabled: true })).status, 401);
  assert.equal((await denied.request("POST", { run: "one" })).status, 401); assert.equal(denied.queries.length, 0);
  const a = api();
  assert.equal((await a.request("PATCH", { id: "other", name: "Hijack" })).status, 404);
  assert.equal((await a.request("POST", { run: "other" })).status, 404);
  assert.equal(a.writes.length, 0); assert.equal(a.runs.length, 0);
});
test("null/array/malformed bodies return a validation error, not a server exception", async () => {
  const a = api();
  for (const body of [null, [], "bad", {}, { enabled: true }]) assert.equal((await a.request("PATCH", body)).status, 400);
  for (const body of [null, [], "bad"]) assert.equal((await a.request("POST", body)).status, 400);
  assert.equal(a.writes.length, 0);
});
test("Run now reads the saved edit and calls the existing runner exactly once, even when paused", async () => {
  const a = api(); await a.request("PATCH", { id: "one", agent: "pulse", prompt: "Check saved edit now" });
  const r = await a.request("POST", { run: "one", agent: "forge", prompt: "Spoofed unsaved instructions" });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { task: "new-task" }); assert.equal(a.runs.length, 1);
  assert.equal(a.runs[0].a.agent, "pulse"); assert.equal(a.runs[0].a.prompt, "Check saved edit now"); assert.equal(a.runs[0].a.enabled, false);
  assert.equal(a.runs[0].why, "run manually"); assert.equal(a.runs[0].a.user_id, "owner");
});
test("Run now rejects a missing agent and preserves runner Stop-all refusal", async () => {
  const a = api(); a.rows[0].agent = "missing";
  assert.equal((await a.request("POST", { run: "one" })).status, 400); assert.equal(a.runs.length, 0);
  const stopped = api({ runnerError: true }); const r = await stopped.request("POST", { run: "one" });
  assert.equal(r.status, 500); assert.match((await r.json()).error, /Stop-all/); assert.equal(stopped.runs.length, 0);
});
test("read/write failures and a deleted row never claim an update succeeded", async () => {
  assert.equal((await api({ readError: true }).request("PATCH", { id: "one", name: "New" })).status, 500);
  assert.equal((await api({ writeError: true }).request("PATCH", { id: "one", name: "New" })).status, 400);
  assert.equal((await api({ deleteBeforeWrite: true }).request("PATCH", { id: "one", name: "New" })).status, 404);
});
