import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// switchStopAll (the Stop-all button and the phone) through the real modules in a child process with a recording fake Supabase.
const root = path.join(import.meta.dirname, "..");
const mod = (p: string) => JSON.stringify(pathToFileURL(path.join(root, p)).href);

test("Stop-all ON cancels every live task it reports, persists, and nothing new runs until it's cleared", { timeout: 90_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-stoprun-"));
  const code = `const rows = [];
const q = (table) => { const r = { table }; const c = { insert: (v) => (rows.push({ ...r, insert: v }), c), update: (v) => (rows.push({ ...r, update: v }), c), upsert: () => c, delete: () => c,
  eq: () => c, or: () => c, in: () => c, is: () => c, not: () => c, lt: () => c, lte: () => c, gte: () => c, order: () => c, limit: () => c, select: () => c,
  maybeSingle: () => c, single: () => c, then: (ok, bad) => Promise.resolve({ data: [], error: null }).then(ok, bad) }; return c; };
const sb = { from: q, rpc: async () => ({ data: null, error: null }) };
const { finishBackground } = await import(${mod("src/lib/core-turn.ts")});
const agents = await import(${mod("src/lib/agents.ts")});
const stop = await import(${mod("src/lib/stop-all.ts")});
const { switchStopAll } = await import(${mod("src/lib/stop-all-run.ts")});
const hang = (signal) => new Promise((res, rej) => { const t = setInterval(() => { if (signal.aborted) { clearInterval(t); rej(signal.reason); } }, 20); setTimeout(() => { clearInterval(t); res({ text: "late", citations: [], trace: [] }); }, 5000); });
const a = finishBackground(sb, "u", "c", "t1", "CORE: a", hang), b = finishBackground(sb, "u", "c", "t2", "CORE: b", hang);
await new Promise((r) => setTimeout(r, 100));
const liveBefore = agents.liveTaskIds().length;
const on = await switchStopAll(sb, "u", true);
await Promise.all([a, b]);
const cancelledRows = rows.filter((r) => r.table === "tasks" && r.update?.status === "cancelled").length;
const liveAfter = agents.liveTaskIds().length;
let ranWhileOn = false;
await finishBackground(sb, "u", "c", "t3", "CORE: c", (s) => { ranWhileOn = !s.aborted; return s.aborted ? Promise.reject(s.reason) : Promise.resolve({ text: "x", citations: [], trace: [] }); });
const off = await switchStopAll(sb, "u", false);
let ranAfterOff = false;
await finishBackground(sb, "u", "c", "t4", "CORE: d", (s) => { ranAfterOff = !s.aborted; return Promise.resolve({ text: "x", citations: [], trace: [] }); });
console.log(JSON.stringify({ liveBefore, cancelled: on.cancelled, onState: on.stop.on, warning: on.warning ?? null, cancelledRows, liveAfter, ranWhileOn, offState: off.stop.on, nowOn: stop.stopAllOn(), ranAfterOff }));
process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: dir }, timeout: 60_000 });
  const got = JSON.parse(stdout.trim().split("\n").pop()!);
  assert.deepEqual(got, { liveBefore: 2, cancelled: 2, onState: true, warning: null, cancelledRows: 2, liveAfter: 0, ranWhileOn: false, offState: false, nowOn: false, ranAfterOff: true });
  const saved = JSON.parse(await readFile(path.join(dir, "stop-all.json"), "utf8"));
  assert.equal(saved.on, false, "the cleared flag is what's on disk");
  const log = await readFile(path.join(dir, "activity.jsonl"), "utf8");
  assert.match(log, /Stop-all turned ON.*2 running task\(s\)\/team\(s\) cancelled/s);
  assert.match(log, /Stop-all turned off/);
});
