import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// A background CORE turn (core-turn.ts finishBackground) must be reachable by Stop-all and Cancel: Stop-all cancels every
// liveTaskIds() entry through cancelTask(). Real modules in a child process; the Supabase client is a recording fake.
const root = path.join(import.meta.dirname, "..");
async function child(body: string) {
  const code = `const rows = [];
const q = (table) => { const r = { table }; const c = { insert: (v) => (rows.push({ ...r, insert: v }), c), update: (v) => (rows.push({ ...r, update: v }), c), eq: () => c, or: () => c, select: () => c,
  then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad) }; return c; };
const sb = { from: q, rpc: async () => ({ data: null, error: null }) };
const { finishBackground } = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/core-turn.ts")).href)});
const agents = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/agents.ts")).href)});
const stop = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/stop-all.ts")).href)});
let toolsAfterStop = 0;
const trace = [{ step: "save_memory", ok: true }];
const run = (signal) => new Promise((res, rej) => {
  const t = setInterval(() => { if (signal.aborted) { clearInterval(t); rej(signal.reason); } }, 20);
  setTimeout(() => { clearInterval(t); if (!signal.aborted) res({ text: "finished anyway", citations: [], trace: [] }); else toolsAfterStop++; }, 3000);
});
${body}`;
  const env = { ...process.env, ORBIT_DATA_DIR: await mkdtemp(path.join(tmpdir(), "orbit-stopbg-")) };
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env, timeout: 60_000 });
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test("Stop-all cancels a running background CORE turn and says what already ran", { timeout: 90_000 }, async () => {
  const got = await child(`const done = finishBackground(sb, "u", "c", "t1", "CORE: x", run, undefined, trace);
await new Promise((r) => setTimeout(r, 100));
const listed = agents.liveTaskIds().includes("t1");
await stop.setStopAll(true);
for (const id of agents.liveTaskIds()) await agents.cancelTask(sb, id); // what switchStopAll does
const out = await done;
const task = rows.find((r) => r.table === "tasks" && r.update)?.update;
console.log(JSON.stringify({ listed, status: task?.status, answer: out?.answer, stillLive: agents.liveTaskIds().includes("t1") }));
process.exit(0);`);
  assert.deepEqual(got, { listed: true, status: "cancelled", stillLive: false,
    answer: "_Stopped: Stop-all is on. No further steps ran. Already done before the stop (not undone): save_memory._" });
});

test("a background turn handed off while Stop-all is on doesn't run", { timeout: 90_000 }, async () => {
  const got = await child(`await stop.setStopAll(true);
let ran = false;
const out = await finishBackground(sb, "u", "c", "t2", "CORE: y", (signal) => { ran = !signal.aborted; return signal.aborted ? Promise.reject(signal.reason) : Promise.resolve({ text: "ran", citations: [], trace: [] }); });
console.log(JSON.stringify({ ran, status: rows.find((r) => r.table === "tasks" && r.update)?.update?.status }));
process.exit(0);`);
  assert.deepEqual(got, { ran: false, status: "cancelled" });
});
