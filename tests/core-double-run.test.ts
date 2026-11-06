import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { claimable, inlineTask } from "../src/lib/task-claim-pure.ts";

const root = path.join(import.meta.dirname, "..");

test("CORE's ask_agent row can't be started by kickQueue first: never queued, still claimable by runTask", () => {
  const row = inlineTask({ user_id: "u", agent: "atlas", title: "CORE asked: x", request: "x" }, Date.UTC(2026, 10, 6));
  assert.equal(row.status, "running"); // kickQueue selects status = queued only
  assert.equal(row.started_at, "2026-11-06T00:00:00.000Z");
  assert.ok(claimable({ ...row, claimed_by: null }, "w1", Date.UTC(2026, 10, 6))); // runTask's "any" claim takes it
});

// Boot reclaim (agents.ts, run by the first kickQueue): a background CORE turn left "running" by the previous process has a
// bg-resume record and is resumed by bg-resume, so it must NOT be marked "Interrupted, press Retry" (Retry would run it twice).
test("the boot sweep leaves a resumable background CORE turn running; other interrupted tasks are still marked", { timeout: 90_000 }, async () => {
  const data = await mkdtemp(path.join(tmpdir(), "orbit-dbl-"));
  await mkdir(path.join(data, "bg-turns"), { recursive: true });
  await writeFile(path.join(data, "bg-turns", "core-1.json"), "{}");
  const code = `const updates = [];
const old = new Date(Date.now() - 3600_000).toISOString();
const q = () => { let isUpdate = false, id = null; const c = {
  select: () => c, eq: (k, v) => { if (k === "id") id = v; return c; }, lt: () => c, is: () => c, not: () => c, limit: () => c, order: () => c, in: () => c, or: () => c,
  update: (v) => { isUpdate = true; return Object.assign(c, { _v: v }); },
  then: (ok, bad) => Promise.resolve(isUpdate ? (updates.push(id), { data: [{ id }], error: null }) : { data: c._queued ? [] : [{ id: "core-1", pending: [], started_at: old }, { id: "agent-2", pending: [], started_at: old }], error: null }).then(ok, bad),
}; return c; };
let calls = 0;
const sb = { from: () => { const c = q(); if (calls++ > 0) c._queued = true; return c; } };
const agents = await import(${JSON.stringify(path.join(root, "src/lib/agents.ts"))});
await agents.kickQueue(sb, "u");
console.log(JSON.stringify(updates.sort()));
process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", path.join(root, "tests/fixtures/ts-resolve.mjs"),
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: data }, timeout: 60_000 });
  assert.deepEqual(JSON.parse(stdout.trim().split("\n").pop()!), ["agent-2"]);
});
