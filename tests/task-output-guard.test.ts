import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as recovery from "../src/lib/tasks-recovery-pure.ts";

// Execute the actual route with only its database, auth and runner boundary replaced.
function harness(mine: { data: unknown; error: unknown }, others: { data: unknown; error: unknown }) {
  let reads = 0, executions = 0, writes = 0;
  const scopes: unknown[] = [];
  const sb = { from(table: string) {
    assert.equal(table, "tasks");
    const index = reads++;
    const result = index === 0 ? mine : others;
    const q = {
      select() { return q; },
      eq(key: string, value: unknown) { if (key === "user_id") scopes.push(value); return q; },
      neq() { return q; }, limit() { return q; },
      update() { writes++; return q; },
      maybeSingle() { return Promise.resolve(result); },
      then(resolve: (r: unknown) => void) { return Promise.resolve(result).then(resolve); },
    };
    return q;
  } };
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/app/api/tasks/[id]/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, Response, require: (name: string) =>
    name.endsWith("supabase/server") ? { requireUser: async () => ({ sb, user: { id: "owner" } }) }
      : name.endsWith("/csrf") ? { crossSiteBlocked: () => false }
      : name.endsWith("tasks-recovery-pure") ? recovery
      : name.endsWith("/agents") ? { ConflictError: Error, kickQueue: () => {}, resolvePending: async () => { executions++; return []; } }
      : name.endsWith("/missions") ? { resumeMissions: async () => {} } : {},
  });
  return {
    stats: () => ({ reads, executions, writes, scopes }),
    post: (action: string) => exports.POST(new Request("http://localhost/api/tasks/task", {
      method: "POST", body: JSON.stringify({ action }),
    }), { params: Promise.resolve({ id: "task" }) }) as Promise<Response>,
  };
}
const action = { tool: "add_task", input: { title: "Report" }, status: "pending" };
const own = { data: { pending: [action] }, error: null };
const empty = { data: [], error: null };

test("approve and resume cannot run when the task's output guard read fails", async () => {
  for (const command of ["approve", "resume"]) {
    const h = harness({ data: null, error: { message: "database timeout" } }, empty);
    const response = await h.post(command);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /No actions were run/);
    assert.deepEqual(h.stats(), { reads: 1, executions: 0, writes: 0, scopes: ["owner"] });
  }
});

test("approve and resume cannot run when competing outputs cannot be checked", async () => {
  for (const command of ["approve", "resume"]) {
    const h = harness(own, { data: null, error: { message: "connection lost" } });
    const response = await h.post(command);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /No actions were run/);
    assert.deepEqual(h.stats(), { reads: 2, executions: 0, writes: 0, scopes: ["owner", "owner"] });
  }
});

test("a missing or foreign task stops before querying competitors or executing", async () => {
  const h = harness({ data: null, error: null }, empty);
  assert.equal((await h.post("approve")).status, 404);
  assert.deepEqual(h.stats(), { reads: 1, executions: 0, writes: 0, scopes: ["owner"] });
});

test("a healthy output check preserves approval and rejects a real clash", async () => {
  const h = harness(own, empty);
  assert.equal((await h.post("approve")).status, 200);
  assert.equal(h.stats().executions, 1);
  assert.deepEqual(h.stats().scopes, ["owner", "owner"]);
  const clash = harness(own, { data: [{ id: "busy", status: "running", pending: [{ ...action, status: "attempting" }] }], error: null });
  const response = await clash.post("approve");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).blockedBy, "busy");
  assert.equal(clash.stats().executions, 0);
});
