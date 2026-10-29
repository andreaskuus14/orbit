import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import * as completionPure from "../src/lib/completion-pure.ts";
import { canRetryTask, completionState, matchesStored } from "../src/lib/completion-pure.ts";
import { blockedMsg, type GuardedId } from "../src/lib/version-pure.ts";
import { verifyRow } from "../src/lib/completion.ts";

test("completion includes failed/rejected actions and delegated outcomes, while pending work stays pending", () => {
  assert.equal(completionState([{ status: "failed" }]).status, "failed");
  assert.equal(completionState([{ status: "rejected" }]).status, "cancelled");
  assert.equal(completionState([{ status: "approved" }], [{ status: "failed" }]).status, "failed");
  assert.equal(completionState([], [{ status: "cancelled" }]).status, "failed");
  assert.equal(completionState([{ status: "failed" }], [{ status: "running" }]).status, "awaiting_approval");
  assert.equal(completionState([{ status: "pending" }]).status, "awaiting_approval");
  assert.deepEqual(completionState([{ status: "approved" }], [{ status: "done" }]), { status: "done", error: null });
  assert.equal(matchesStored({ content: "x" }, { content: "y" }), false);
  assert.equal(canRetryTask([]), true);
  assert.equal(canRetryTask([{ status: "pending" }]), true);
  for (const status of ["approved", "failed", "rejected"]) assert.equal(canRetryTask([{ status }]), false);
});

// Execute the actual approval handler, replacing only its platform/AI imports.
// The CommonJS transpile uses the existing TypeScript dependency; no server or Claude call is involved.
class MigrationBlocked extends Error {}
const guard = (missing: Set<string>) => ({ // migration-guard stub: the real refusal message for a missing guarded migration
  MigrationBlocked,
  requireMigration: async (_sb: unknown, id: GuardedId) => { if (missing.has(id)) throw new MigrationBlocked(blockedMsg(id)); },
  refuse: (id: GuardedId) => new MigrationBlocked(blockedMsg(id)),
});
function approvalHarness(rows: Record<string, unknown>[], missing = new Set<string>()) {
  const db = rows.map((r) => structuredClone(r));
  const sb = { from(table: string) {
    assert.equal(table, "tasks");
    const filters: [string, unknown][] = []; let patch: object | null = null;
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      in(key: string, values: unknown[]) { filters.push([key, new Set(values)]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; }, not() { return query; },
      limit() { return query; },
      order() { return query; },
      update(value: object) { patch = value; return query; },
      exec(single = false) {
        const matches = db.filter((r) => filters.every(([k, v]) => v instanceof Set ? v.has(r[k]) : r[k] === v));
        if (patch) for (const r of matches) Object.assign(r, structuredClone(patch));
        return { data: single ? matches[0] ?? null : structuredClone(matches), error: null };
      },
      single() { return Promise.resolve(query.exec(true)); }, maybeSingle() { return Promise.resolve(query.exec(true)); },
      then(resolve: (r: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve(query.exec()).then(resolve, reject); },
    };
    return query;
  } };
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/lib/agents.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name === "./completion-pure" ? completionPure
    : name === "./memory" ? { KINDS: ["note"] } : name === "./claude" ? { emit: async () => {} } : name === "./stop-all" ? { stopAllOn: () => false } : name === "./authority" ? { authorizeAction: async () => ({ ok: true }) } : name === "./migration-guard" ? guard(missing) : {}, console, crypto });
  return { sb, db, resolve: exports.resolvePending, tools: exports.TOOLS };
}
const task = (id: string, parent: string | null = null, status = "awaiting_approval", pending: unknown[] = []) => ({ id, user_id: "owner", parent_id: parent, project_id: null, status, agent: "nova", title: id, request: "", pending });

test("actual approval flow treats an Error string as failure, preserves successful receipts, and fails ancestors", async () => {
  const h = approvalHarness([task("parent"), task("child", "parent", "awaiting_approval", [
    { tool: "save_memory", input: {}, status: "pending" }, { tool: "add_task", input: {}, status: "pending" },
  ])]);
  h.tools.save_memory.run = async (ctx: any) => { ctx.evidence.push({ kind: "memory", id: "saved-id" }); return "Saved and read back"; };
  h.tools.add_task.run = async () => "Error: unknown agent";
  await h.resolve(h.sb, "owner", "child", true);
  const child = h.db.find((r) => r.id === "child")!;
  assert.equal(child.status, "failed");
  assert.equal((child.pending as any[])[0].evidence[0].id, "saved-id");
  assert.equal((child.pending as any[])[1].status, "failed");
  assert.equal(h.db.find((r) => r.id === "parent")!.status, "failed");
  await assert.rejects(() => h.resolve(h.sb, "owner", "child", true), /Nothing is waiting/);
});

test("approval of a keyed write refuses while 0023_attempt_ids is missing (stays pending) and runs once it is applied", async () => {
  const rows = [task("t", null, "awaiting_approval", [{ tool: "add_task", input: {}, status: "pending" }])];
  const blocked = approvalHarness(rows, new Set(["0023"]));
  blocked.tools.add_task.run = () => { throw new Error("Must not execute"); };
  await assert.rejects(() => blocked.resolve(blocked.sb, "owner", "t", true), (e: Error) => e.message === blockedMsg("0023"));
  assert.equal(blocked.db[0].status, "awaiting_approval");
  assert.equal((blocked.db[0].pending as any[])[0].status, "pending");
  const ok = approvalHarness(rows);
  ok.tools.add_task.run = async () => "Added";
  await ok.resolve(ok.sb, "owner", "t", true);
  assert.equal((ok.db[0].pending as any[])[0].status, "approved");
});

test("actual rejection runs no tool, never completes a parent, and leaves running siblings unsettled", async () => {
  const h = approvalHarness([task("grand"), task("parent", "grand"), task("child", "parent", "awaiting_approval", [{ tool: "save_memory", input: {}, status: "pending" }]), task("sibling", "parent", "running")]);
  h.tools.save_memory.run = () => { throw new Error("Must not execute"); };
  await h.resolve(h.sb, "owner", "child", false);
  assert.equal(h.db.find((r) => r.id === "child")!.status, "cancelled");
  assert.equal(h.db.find((r) => r.id === "parent")!.status, "awaiting_approval");
  assert.equal(h.db.find((r) => r.id === "grand")!.status, "awaiting_approval");
});

test("actual successful approval settles all ancestors; another account cannot approve it", async () => {
  const h = approvalHarness([task("grand"), task("parent", "grand"), task("child", "parent", "awaiting_approval", [{ tool: "save_memory", input: {}, status: "pending" }])]);
  h.tools.save_memory.run = async () => "Saved";
  await assert.rejects(() => h.resolve(h.sb, "stranger", "child", true));
  await h.resolve(h.sb, "owner", "child", true);
  assert.ok(h.db.every((r) => r.status === "done"));
});

test("read-back verification scopes account and id, and rejects missing/mismatched writes without retrying", async () => {
  const seen: [string, unknown][] = []; let reads = 0;
  const make = (data: unknown) => ({ from(table: string) { assert.equal(table, "memories"); return { select() { return this; }, eq(k: string, v: unknown) { seen.push([k, v]); return this; }, async maybeSingle() { reads++; return { data, error: null }; } }; } });
  await verifyRow(make({ content: "saved" }) as never, "owner", "memories", "record", { content: "saved" });
  assert.deepEqual(seen, [["user_id", "owner"], ["id", "record"]]);
  await assert.rejects(() => verifyRow(make(null) as never, "owner", "memories", "record", { content: "saved" }), /may already exist/);
  await assert.rejects(() => verifyRow(make({ content: "wrong" }) as never, "owner", "memories", "record", { content: "saved" }), /confirmation failed/);
  assert.equal(reads, 3);
});

test("actual retry endpoint preserves receipts in both root and delegated tasks", async () => {
  for (const delegated of [false, true]) {
    const h = approvalHarness([task("root", null, "failed", delegated ? [] : [{ status: "approved" }]),
      ...(delegated ? [task("child", "root", "failed", [{ status: "failed" }])] : [])]);
    let kicks = 0;
    const exports: Record<string, any> = {};
    const source = ts.transpileModule(readFileSync(new URL("../src/app/api/tasks/[id]/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { exports, Response, require: (name: string) => name.endsWith("supabase/server") ? { requireUser: async () => ({ sb: h.sb, user: { id: "owner" } }) }
      : name.endsWith("completion-pure") ? { canRetryTask } : name.endsWith("/agents") ? { kickQueue: () => { kicks++; }, ConflictError: Error } : name.endsWith("/csrf") ? { crossSiteBlocked: () => false } : {} });
    const response = await exports.POST(new Request("http://localhost/api/tasks/root", { method: "POST", body: JSON.stringify({ action: "retry" }) }), { params: Promise.resolve({ id: "root" }) });
    assert.equal(response.status, 409);
    assert.equal(h.db[0].status, "failed");
    assert.equal(kicks, 0);
  }
});

test("actual file-open endpoint checks the signed-in owner's file before issuing a fresh local preview", async () => {
  const reads: unknown[] = []; let signs = 0;
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/app/api/workspace/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Response, URL, require: (name: string) => name.endsWith("supabase/server") ? { requireUser: async () => ({ user: { id: "owner" } }) }
    : name.endsWith("workspace-pure") ? { isSlug: (x: string) => x === "site" }
    : name.endsWith("/workspace") ? { readWsFile: async (...args: unknown[]) => { reads.push(args); return args[2] === "index.html" ? { text: "<h1>Saved</h1>", size: 14 } : null; }, previewUrl: async () => { signs++; return "/w/signed/index.html"; } } : {} });
  const ok = await exports.GET(new Request("http://localhost/api/workspace?ws=site&file=index.html&open=1"));
  assert.equal(ok.status, 302); assert.equal(ok.headers.get("location"), "/w/signed/index.html");
  assert.match(ok.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(Array.from(reads[0] as unknown[]), ["owner", "site", "index.html"]);
  const missing = await exports.GET(new Request("http://localhost/api/workspace?ws=site&file=missing.html&open=1"));
  assert.equal(missing.status, 404); assert.equal(signs, 1);
});

test("actual task detail includes nested approvals and receipts, scoped to the signed-in account", async () => {
  const h = approvalHarness([task("root"), task("child", "root"), task("nested", "child", "awaiting_approval", [{ status: "pending" }]),
    { ...task("foreign", "root"), user_id: "stranger" }]);
  const exports: Record<string, any> = {};
  const source = ts.transpileModule(readFileSync(new URL("../src/app/api/tasks/[id]/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Response, require: (name: string) => name.endsWith("supabase/server") ? { requireUser: async () => ({ sb: h.sb, user: { id: "owner" } }) } : {} });
  const response = await exports.GET(new Request("http://localhost/api/tasks/root"), { params: Promise.resolve({ id: "root" }) });
  const body = await response.json();
  assert.deepEqual(body.children.map((c: any) => c.id), ["child", "nested"]);
  assert.equal(body.children[1].pending[0].status, "pending");
});

test("workspace writes are readable with the exact UTF-8 content and byte count", async () => {
  const prefix = path.join(os.tmpdir(), "orbit-proof-");
  const dir = await mkdtemp(prefix), previous = process.env.ORBIT_DATA_DIR;
  process.env.ORBIT_DATA_DIR = dir;
  try {
    const ws = await import("../src/lib/workspace.ts");
    const uid = "11111111-1111-4111-8111-111111111111";
    const created = await ws.createWorkspace(uid, "proof");
    assert.ok(!("error" in created));
    const content = "# Tere\nSaved: õäöü ✓";
    const r = await ws.writeWsFile(uid, "proof", "report.md", content);
    assert.ok(!("error" in r));
    if ("error" in r) return;
    assert.equal(r.bytes, Buffer.byteLength(content));
    assert.deepEqual(await ws.readWsFile(uid, "proof", r.path), { text: content, size: r.bytes });
  } finally {
    if (previous === undefined) delete process.env.ORBIT_DATA_DIR; else process.env.ORBIT_DATA_DIR = previous;
    assert.ok(path.resolve(dir).startsWith(path.resolve(prefix)));
    await rm(dir, { recursive: true, force: true });
  }
});

test("executed vs verified: a task without read-back evidence never shows verified", async () => {
  const { taskVerified, doneLabel } = await import("../src/lib/completion-pure.ts");
  assert.equal(taskVerified("done", []), false);
  assert.equal(taskVerified("done", [{ status: "approved" }, { status: "approved", evidence: [] }]), false);
  assert.equal(taskVerified("done", [{ status: "rejected", evidence: [{ kind: "memory", id: "m" }] }]), false);
  assert.equal(taskVerified("failed", [{ status: "approved", evidence: [{ kind: "memory", id: "m" }] }]), false);
  assert.equal(taskVerified("done", [{ status: "approved", evidence: [{ kind: "memory", id: "m" }] }]), true);
  assert.equal(doneLabel(false), "Done · not verified");
  assert.equal(doneLabel(true), "Verified");
});
