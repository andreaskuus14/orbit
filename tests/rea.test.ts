import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidencePage, isReaTool, parseReaEvidence, reaActionBlocked, REA_LIMITS, sourceFile, validJob } from "../src/lib/rea-pure.ts";
import { snapshotSources } from "../src/lib/rea-snapshot.ts";
import { runReaCommand } from "../src/lib/rea-process.ts";
import { startReaJob, readReaJob, cancelReaJob, reaEvidenceText, reaStatus, readReaPage } from "../src/lib/rea.ts";
import { runReaTool } from "../src/lib/core-rea.ts";

const fixture = fileURLToPath(new URL("./fixtures/rea-fake.mjs", import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 10));
const uid = "account-a";
async function untilDone(id: string) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const j = await readReaJob(uid, id);
    if (!["snapshotting", "analyzing"].includes(j.state) && !(await reaStatus(uid)).busy) return j;
    if (Date.now() > deadline) throw new Error("Fixture job did not finish");
    await tick();
  }
}

test("REA input policy, action gating and paging preserve coverage", () => {
  for (const s of ["index.ts", "App.tsx", "index.mjs", "package.json", "tsconfig.build.json"]) assert.equal(sourceFile(s), true);
  for (const s of [".env", ".env.local", "credentials.json", "tokens.ts", "private-key.ts", "package-lock.json", "movie.mp4"]) assert.equal(sourceFile(s), false);
  assert.equal(isReaTool("rea_analyze"), true); assert.equal(isReaTool("exec"), false);
  assert.equal(validJob("../../secret"), false);
  assert.equal(reaActionBlocked("rea_analyze", "Analyze the ORBIT project", false), null);
  assert.ok(reaActionBlocked("rea_analyze", "Analyze the ORBIT project", true));
  assert.ok(reaActionBlocked("rea_analyze", "Don't analyze the ORBIT project", false));
  assert.ok(reaActionBlocked("rea_analyze", "Tell me the news", false));
  assert.equal(reaActionBlocked("rea_cancel", "Cancel the REA analysis", false), null);
  assert.ok(reaActionBlocked("rea_cancel", "Read the REA findings", false));
  const ev = parseReaEvidence(JSON.stringify({ evidence_id: `ev_${"a".repeat(64)}`, operation: "analyze_javascript_application", normalized_result: { graph: { nodes: [{ label: "hello.ts", source: "界".repeat(6000) }, { label: "other.ts" }], edges: [] } } }));
  const first = evidencePage(ev, "modules", 0, "hello.ts"), second = evidencePage(ev, "modules", first.next_offset!, "hello.ts");
  assert.equal(first.text.length, REA_LIMITS.pageChars); assert.equal(second.offset, first.next_offset);
  assert.equal((first.text + second.text).includes("other.ts"), false);
  assert.throws(() => parseReaEvidence('{"ok":false,"error":"failure"}'), /failure/);
  assert.throws(() => parseReaEvidence('{"ok":true,"data":{}}'), /did not return/);
  assert.throws(() => evidencePage(ev, "evidence", -1), /offset/);
});

test("bundled add-on reports unbuilt until compiled and CORE executes it without an override", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rea-bundled-"));
  const cwd = process.cwd();
  const keys = ["ORBIT_REA_ENABLED", "ORBIT_ALLOWED_EMAILS", "ORBIT_DATA_DIR", "ORBIT_REA_ENTRYPOINT", "ORBIT_REA_TARGETS_JSON"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(async () => {
    process.chdir(cwd);
    for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(path.join(dir, "vendor", "rea", "scripts"), { recursive: true });
  await writeFile(path.join(dir, "vendor", "rea", "scripts", "rea.mjs"), await readFile(fixture));
  await writeFile(path.join(dir, "fixture.ts"), "export const bundled = true;");
  process.chdir(dir);
  process.env.ORBIT_REA_ENABLED = "true";
  process.env.ORBIT_ALLOWED_EMAILS = "owner@orbit.test";
  process.env.ORBIT_DATA_DIR = path.join(dir, ".data");
  delete process.env.ORBIT_REA_ENTRYPOINT;
  delete process.env.ORBIT_REA_TARGETS_JSON;
  assert.equal((await reaStatus(uid)).installed, false);
  await assert.rejects(startReaJob(uid), /not built/);
  const compiled = path.join(dir, "vendor", "rea", "dist", "cli-runtime");
  await mkdir(compiled, { recursive: true });
  for (const file of ["cli.js", "cliOutput.js", "cliResultOutput.js"]) await writeFile(path.join(compiled, file), "// fixture only");
  assert.equal((await reaStatus(uid)).installed, true);
  const response = JSON.parse(await runReaTool(uid, "rea_analyze", {}, "Analyze the Orbit project", false));
  const done = await untilDone(response.id);
  assert.equal(done.state, "done", done.error);
  assert.equal(done.source?.files, 1, "the bundled engine must not enter the target snapshot");
});

test("source snapshot excludes secrets, builds and symlink escapes with per-file hashes", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rea-snapshot-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source"), dest = path.join(dir, "copy"); await mkdir(source);
  for (const name of ["src", "node_modules", ".git"]) await mkdir(path.join(source, name));
  await writeFile(path.join(source, "src", "a.ts"), "export const a = 1;");
  await writeFile(path.join(source, "package.json"), "{}");
  await writeFile(path.join(source, ".env.local"), "SECRET=value");
  await writeFile(path.join(source, "node_modules", "bad.ts"), "should not appear");
  await writeFile(path.join(dir, "outside.ts"), "outside");
  try { await symlink(path.join(dir, "outside.ts"), path.join(source, "escape.ts")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EPERM") throw e; }
  const m = await snapshotSources(source, dest, new AbortController().signal);
  assert.deepEqual(m.files.map((f) => f.path), ["package.json", "src/a.ts"]);
  assert.match(m.files[0].sha256, /^[a-f0-9]{64}$/); assert.ok(m.omitted_entries >= 3);
  assert.equal(await readFile(path.join(dest, "src", "a.ts"), "utf8"), "export const a = 1;");
  assert.match(m.policy, /not an atomic/);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(snapshotSources(source, path.join(dir, "cancelled"), ac.signal));
});

test("REA process uses the public CLI boundary, bounds output and closes before cancellation returns", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rea-command-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "folder with spaces & symbols"); await mkdir(source);
  const file = path.join(source, "fixture.ts"); await writeFile(file, "export const answer = 42;");
  const old = process.env.ORBIT_REA_TEST_SECRET; process.env.ORBIT_REA_TEST_SECRET = "must-not-leak";
  t.after(() => { if (old === undefined) delete process.env.ORBIT_REA_TEST_SECRET; else process.env.ORBIT_REA_TEST_SECRET = old; });
  const result = await runReaCommand(fixture, source, new AbortController().signal, () => {});
  assert.equal(parseReaEvidence(result).operation, "analyze_javascript_application");
  await writeFile(file, "FLOOD");
  await assert.rejects(runReaCommand(fixture, source, new AbortController().signal, () => {}, { outputBytes: 1000, timeoutMs: 5000 }), /output budget/);
  await writeFile(file, "WAIT");
  const ac = new AbortController(); let progress = false;
  const run = runReaCommand(fixture, source, ac.signal, () => { progress = true; ac.abort(); });
  await assert.rejects(run, /cancelled/); assert.equal(progress, true);
  await assert.rejects(runReaCommand(fixture, source, new AbortController().signal, () => {}, { outputBytes: 1000, timeoutMs: 50 }), /time budget/);
});

test("jobs retain full Evidence, isolate accounts, enforce registration and detect corruption", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rea-job-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const keys = ["ORBIT_REA_ENABLED", "ORBIT_ALLOWED_EMAILS", "ORBIT_DATA_DIR", "ORBIT_REA_ENTRYPOINT", "ORBIT_REA_TARGETS_JSON"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
  const source = path.join(dir, "project"); await mkdir(source); await writeFile(path.join(source, "fixture.ts"), "export const ok = true;");
  process.env.ORBIT_REA_ENABLED = "true"; process.env.ORBIT_ALLOWED_EMAILS = "owner@orbit.test";
  process.env.ORBIT_DATA_DIR = path.join(dir, "data"); process.env.ORBIT_REA_ENTRYPOINT = fixture;
  process.env.ORBIT_REA_TARGETS_JSON = JSON.stringify({ test: source });
  await assert.rejects(startReaJob(uid, "../../project"), /Unknown target/);
  const start = await startReaJob(uid, "test");
  await assert.rejects(startReaJob(uid, "test"), /busy/);
  const done = await untilDone(start.id); assert.equal(done.state, "done", done.error);
  assert.equal(done.source?.files, 1);
  await assert.rejects(readReaJob("account-b", done.id));
  const text = await reaEvidenceText(uid, done.id); assert.equal(parseReaEvidence(text).evidence_id, done.evidence_id);
  const page = await readReaPage(uid, done.id, "modules", 0, "fixture.ts"); assert.match(page.text, /fixture.ts/);
  assert.equal((await reaStatus(uid)).jobs.length, 1);
  const tool = await runReaTool(uid, "rea_read", { job: done.id }, "Read the findings", true); assert.ok(tool.length < 8000); assert.match(tool, /evidence_id/);
  assert.match(await runReaTool(uid, "rea_analyze", { target: "test" }, "Read a webpage", false), /^Error:/);
  assert.match(await runReaTool(uid, "rea_read", { offset: -1 }, "Read it", false), /^Error:/);
  const { createHash } = await import("node:crypto");
  const saved = path.join(dir, "data", "rea", "jobs", createHash("sha256").update(uid).digest("hex"), done.id);
  await assert.rejects(readFile(path.join(saved, "source", "fixture.ts")), /ENOENT/);
  await writeFile(path.join(saved, "evidence.json"), text + " ");
  await assert.rejects(reaEvidenceText(uid, done.id), /checksum/);
  await writeFile(path.join(source, "fixture.ts"), "WAIT");
  const waiting = await startReaJob(uid, "test");
  await cancelReaJob(uid, waiting.id);
  assert.equal((await untilDone(waiting.id)).state, "cancelled");
  await writeFile(path.join(source, "fixture.ts"), "INVALID");
  const invalid = await startReaJob(uid, "test"); assert.equal((await untilDone(invalid.id)).state, "failed");
  await assert.rejects(reaEvidenceText(uid, invalid.id), /failed/);
  process.env.ORBIT_ALLOWED_EMAILS = ""; await assert.rejects(reaStatus(uid), /account email/);
  process.env.ORBIT_REA_ENABLED = "false"; await assert.rejects(reaStatus(uid), /disabled/);
});
