import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as completion from "../src/lib/completion-pure.ts";
import * as execution from "../src/lib/execution.ts"; // the real execution-evidence module agents.ts uses

function harness(fail: "read" | "write" | null) {
  const pending = [
    { status: "approved", evidence: [{ kind: "memory", id: "saved" }] },
    { status: "attempting", attempt: "orphan:1" },
  ];
  const row = { id: "orphan", user_id: "owner", status: "running", started_at: "2020-01-01T00:00:00Z", pending };
  let reads = 0, updates = 0, failures = fail ? 1 : 0;
  const errors: unknown[] = [];
  const sb = { from(table: string) {
    assert.equal(table, "tasks");
    let patch: Record<string, unknown> | null = null;
    const filters: [string, unknown][] = [];
    const q = {
      select() { return q; }, eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      lt() { return q; }, is() { return q; }, not() { return q; }, limit() { return q; },
      update(value: Record<string, unknown>) { patch = value; return q; },
      then(resolve: (r: unknown) => void) {
        if (patch) updates++; else reads++;
        const error = failures && (patch ? fail === "write" : fail === "read") ? (failures--, { message: "temporary database outage" }) : null;
        const matches = filters.every(([k, v]) => (row as Record<string, unknown>)[k] === v);
        if (!error && patch && matches) Object.assign(row, structuredClone(patch));
        return Promise.resolve({ data: error ? null : !patch && matches ? [structuredClone(row)] : [], error }).then(resolve);
      },
    };
    return q;
  } };
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/lib/agents.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, crypto, console: { error: (...args: unknown[]) => errors.push(args) }, require: (name: string) =>
    name === "./completion-pure" ? completion : name === "./memory" ? { KINDS: ["note"] } : name === "./stop-all" ? { stopAllOn: () => true } : name === "./execution" ? execution : {},
  });
  return { row, errors, counts: () => ({ reads, updates }), kick: () => exports.kickQueue(sb, "owner") };
}

for (const fail of ["read", "write"] as const) test(`restart sweep retries after a transient ${fail} error`, async () => {
  const h = harness(fail);
  await h.kick();
  assert.equal(h.row.status, "running");
  assert.equal(h.errors.length, 1, "the failure must reach kickQueue's existing recovery handler");
  await h.kick();
  assert.equal(h.row.status, "failed", "the same process must retry the interrupted sweep");
  assert.equal(h.counts().reads, 2);
  assert.equal(h.row.pending[0].status, "approved");
  assert.deepEqual(h.row.pending[0].evidence, [{ kind: "memory", id: "saved" }]);
  assert.equal(h.row.pending[1].status, "uncertain");
  assert.equal(h.row.pending[1].attempt, "orphan:1");
  const counts = h.counts();
  await h.kick();
  assert.deepEqual(h.counts(), counts, "only a successful sweep is cached");
});

test("a successful restart sweep runs once and never reruns an action", async () => {
  const h = harness(null);
  await h.kick();
  await h.kick();
  assert.equal(h.row.status, "failed");
  assert.equal(h.errors.length, 0);
  assert.deepEqual(h.counts(), { reads: 1, updates: 1 });
  assert.equal(h.row.pending[1].status, "uncertain");
});
