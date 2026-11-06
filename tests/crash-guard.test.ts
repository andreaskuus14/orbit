import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// A server-like child: a Next.js-style handler that logs uncaught errors and keeps serving, the real phonemizer package (loaded by
// kokoro-js for calls and story clips), then a failing briefing: a decoder left unread on a cut-off gzip body (the 2026-11-06 crash),
// plus an unhandled rejection. Guarded, the server stays up and the crash log names the job; unguarded, phonemizer's handler ends it.
const root = path.join(import.meta.dirname, "..");
const server = (guarded: boolean) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", path.join(root, "tests/fixtures/ts-resolve.mjs"),
  "--input-type=module", "-e", `
import { createGunzip } from "node:zlib";
process.on("uncaughtException", (e) => console.log("next logged:", e.code ?? e.message)); // what next start does
const g = await import(${JSON.stringify(path.join(root, "src/lib/crash-guard.ts"))});
g.installCrashLog();
await (${guarded} ? g.importWithoutExitHandlers(() => import("phonemizer")) : import("phonemizer"));
await g.asJob("briefing:midday", async () => { createGunzip().end(Buffer.from([0x1f, 0x8b, 8, 0])); void Promise.reject(new Error("a failed step nobody awaited")); });
await new Promise((ok) => setTimeout(ok, 800));
console.log("still serving");`], { cwd: root, timeout: 50_000 }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));

test("a failed briefing can't end the server once kokoro's phonemizer is loaded; the crash log names the job", { timeout: 60_000 }, async () => {
  const r = await server(true);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /still serving/);
  assert.match(r.stdout, /next logged: Z_BUF_ERROR/); // still logged, not swallowed
  assert.match(r.stderr, /\[orbit\] uncaughtException in briefing:midday \(Z_BUF_ERROR\)/);
  assert.match(r.stderr, /removed a process uncaughtException handler/);
});

test("without the guard phonemizer's handler ends the server (the failure the guard prevents)", { timeout: 60_000 }, async () => {
  const r = await server(false);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.stdout, /still serving/);
});

test("importWithoutExitHandlers keeps handlers that were there before and the import's result", async () => {
  const { importWithoutExitHandlers } = await import("../src/lib/crash-guard.ts");
  const mine = () => {};
  process.on("unhandledRejection", mine);
  const added = () => {};
  const v = await importWithoutExitHandlers(async () => { process.on("unhandledRejection", added); return 42; });
  assert.equal(v, 42);
  assert.ok(process.listeners("unhandledRejection").includes(mine));
  assert.ok(!process.listeners("unhandledRejection").includes(added));
  process.off("unhandledRejection", mine);
});
