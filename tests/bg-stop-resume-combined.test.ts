import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// #411 (Stop-all/Cancel reach background CORE turns) + #412 (no double runs) together, on the real modules: bg-resume's sweep,
// core-turn's finishBackground, agents' live map / cancelTask / boot sweep, stop-all. Only Supabase and the model turn are faked.
const root = path.join(import.meta.dirname, "..");
async function scenario(body: string, rowStatus = "running") {
  const data = await mkdtemp(path.join(tmpdir(), "orbit-combo-"));
  await mkdir(path.join(data, "bg-turns"), { recursive: true });
  const code = `const L = (m) => import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib")).href)} + "/" + m);
const { newBgTurn } = await L("bg-resume-pure.ts");
const fs = await import("node:fs/promises");
const rec = (st) => fs.writeFile(${JSON.stringify(path.join(data, "bg-turns", "t1.json"))}, JSON.stringify(newBgTurn({ taskId: "t1", userId: "u1", chatId: "c1", request: "Build the golf site now.", title: "Golf site" }, Date.now() - 60000)));
const rows = { t1: { id: "t1", status: ${JSON.stringify(rowStatus)} } }, messages = [];
const sb = { from: (table) => { const f = []; let patch = null, ins = null; const c = {
  select: () => c, eq: (k, v) => (f.push([k, v]), c), lt: () => c, is: () => c, not: () => c, limit: () => c, order: () => c, in: () => c, or: () => c,
  update: (v) => (patch = v, c), insert: (v) => (ins = v, c),
  then: (ok, bad) => Promise.resolve((() => {
    if (table === "messages") { if (ins) messages.push(ins.content); return { data: messages.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content })), error: null }; }
    if (table !== "tasks") return { data: [], error: null };
    const hit = Object.values(rows).filter((r) => f.every(([k, v]) => k === "user_id" || r[k] === v));
    if (patch) { hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    return { data: hit, error: null };
  })()).then(ok, bad) }; return c; } };
const bg = await L("bg-resume.ts"), { finishBackground } = await L("core-turn.ts"), agents = await L("agents.ts"), stop = await L("stop-all.ts");
let toolsStarted = 0, toolsAfterStop = 0, runs = 0;
const runCoreFor = async (_ms, _bg, _sb, _u, _h, _d, signal) => { // a turn that keeps calling a slow tool until it's stopped
  runs++;
  for (let i = 0; i < 50; i++) {
    if (signal.aborted) throw signal.reason;
    toolsStarted++; if (stop.stopAllOn()) toolsAfterStop++;
    await new Promise((r, j) => { const t = setTimeout(r, 40); signal.addEventListener("abort", () => { clearTimeout(t); j(signal.reason); }, { once: true }); });
  }
  return { text: "Built it.", citations: [], trace: [] };
};
const deps = async () => ({ finishBackground, runCoreFor, BACKGROUND_TURN_MS: 60000, parseLang: () => "en", coreSessionStore: { get: () => undefined, set: () => {} },
  chatProjectContext: async () => ({ text: "", tainted: false }) });
const until = async (condition, label) => {
  for (let i = 0; i < 200; i++) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for " + label);
};
const onDisk = async () => (await fs.readdir(${JSON.stringify(path.join(data, "bg-turns"))})).filter((n) => n.endsWith(".json"));
messages.push("Build the golf site now.");
${body}
process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: data }, timeout: 80_000 });
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test("Stop-all during a resumed turn's tool call: the turn stops, nothing runs after, the record goes, Retry is possible again", { timeout: 90_000 }, async () => {
  const got = await scenario(`await rec();
await bg.resumeBackgroundTurns(sb, "u1", deps);
await until(() => toolsStarted > 0 && agents.liveTaskIds().includes("t1"), "the resumed tool call");
const duringResume = { live: agents.liveTaskIds().includes("t1"), retryBlocked: (await bg.bgTurnIds()).has("t1") };
const savingStop = stop.setStopAll(true);
await Promise.all(agents.liveTaskIds().map((id) => agents.cancelTask(sb, id))); // switchStopAll signals before awaiting persistence
await savingStop;
await until(async () => !(await onDisk()).length && messages.at(-1)?.startsWith("_Stopped:") &&
  !(await bg.bgTurnIds()).has("t1"), "the stop receipt, record cleanup and Retry guard release");
console.log(JSON.stringify({ duringResume, status: rows.t1.status, toolsAfterStop, onDisk: await onDisk(), retryBlocked: (await bg.bgTurnIds()).has("t1"),
  note: messages.at(-1) }));`);
  assert.deepEqual(got.duringResume, { live: true, retryBlocked: true }); // Retry refused while the resume runs (#412)
  assert.equal(got.status, "cancelled"); // reached by Stop-all (#411)
  assert.equal(got.toolsAfterStop, 0);
  assert.deepEqual(got.onDisk, []); // nothing left to resume after a restart
  assert.equal(got.retryBlocked, false); // a stopped task can be retried by hand
  assert.match(got.note, /^_Stopped: Stop-all is on\. No further steps ran\._$/);
});

test("restart after a stop: a record left behind for a cancelled task is not resumed", { timeout: 90_000 }, async () => {
  const got = await scenario(`await rec();
await bg.resumeBackgroundTurns(sb, "u1", deps);
await until(async () => !(await onDisk()).length, "cancelled record cleanup");
console.log(JSON.stringify({ runs, status: rows.t1.status, onDisk: await onDisk() }));`, "cancelled");
  assert.deepEqual(got, { runs: 0, status: "cancelled", onDisk: [] });
});

test("restart while Stop-all is still on: the left-behind turn doesn't run and is closed as stopped", { timeout: 90_000 }, async () => {
  const got = await scenario(`await stop.setStopAll(true);
await rec();
await bg.resumeBackgroundTurns(sb, "u1", deps);
await until(async () => !(await onDisk()).length && rows.t1.status === "cancelled", "Stop-all restart cleanup");
console.log(JSON.stringify({ toolsStarted, status: rows.t1.status, onDisk: await onDisk() }));`);
  assert.deepEqual(got, { toolsStarted: 0, status: "cancelled", onDisk: [] });
});

test("the boot sweep doesn't mark a resumable turn interrupted, so Retry can't start a second copy while it resumes", { timeout: 90_000 }, async () => {
  const got = await scenario(`await rec();
rows.t1.started_at = new Date(Date.now() - 3600000).toISOString(); rows.t1.parent_id = null;
await agents.kickQueue(sb, "u1"); // the boot sweep (reclaimInterrupted) runs on the first kick
console.log(JSON.stringify({ status: rows.t1.status, retryBlocked: (await bg.bgTurnIds()).has("t1") }));`);
  assert.deepEqual(got, { status: "running", retryBlocked: true });
});
