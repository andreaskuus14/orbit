import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { rethrowsOnly } from "../src/lib/crash-guard.ts";

// A server-like child: a Next.js-style handler that logs uncaught errors and keeps serving, the real phonemizer package (kokoro-js
// loads it; Next's entry preload loads that at boot, before or after the guard), then a failing briefing: a decoder left unread on
// a cut-off gzip body (the 2026-11-06 crash) plus an unhandled rejection. Guarded, in either load order, the server stays up and the
// crash log names the job; unguarded, phonemizer's handler ends it.
const root = path.join(import.meta.dirname, "..");
const server = (order: "guard-first" | "phonemizer-first" | "unguarded") => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", path.join(root, "tests/fixtures/ts-resolve.mjs"),
  "--input-type=module", "-e", `
import { createGunzip } from "node:zlib";
process.on("uncaughtException", (e) => console.log("next logged:", e.code ?? e.message)); // what next start does
process.on("unhandledRejection", (e) => console.log("next logged rejection:", e?.message ?? e));
const g = await import(${JSON.stringify(path.join(root, "src/lib/crash-guard.ts"))});
if (${JSON.stringify(order)} === "guard-first") g.installCrashGuard();
await import("phonemizer");
if (${JSON.stringify(order)} === "phonemizer-first") g.installCrashGuard();
await g.asJob("briefing:midday", async () => { createGunzip().end(Buffer.from([0x1f, 0x8b, 8, 0])); void Promise.reject(new Error("a failed step nobody awaited")); });
await new Promise((ok) => setTimeout(ok, 800));
console.log("still serving");`], { cwd: root, timeout: 50_000 }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));

for (const order of ["guard-first", "phonemizer-first"] as const) {
  test(`a failed briefing can't end the server once phonemizer is loaded (${order}); errors are still logged, with the job`, { timeout: 60_000 }, async () => {
    const r = await server(order);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /still serving/);
    assert.match(r.stdout, /next logged: Z_BUF_ERROR/); // still reported, not swallowed
    assert.match(r.stdout, /next logged rejection: a failed step nobody awaited/);
    assert.match(r.stderr, /\[orbit\] uncaughtException in briefing:midday \(Z_BUF_ERROR\)/);
    assert.equal((r.stderr.match(/dropped a process (uncaughtException|unhandledRejection) handler that only re-throws/g) ?? []).length, 2);
  });
}

test("without the guard phonemizer's handler ends the server (the failure the guard prevents)", { timeout: 60_000 }, async () => {
  const r = await server("unguarded");
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.stdout, /still serving/);
});

test("only handlers whose whole body re-throws count; logging handlers (Next's, ORBIT's) never do", () => {
  for (const src of ["function(A){throw A}", "function(A){if(!(A instanceof O))throw A}", "function (e) { throw e; }", "(e) => { throw e }", "e=>{throw e}"])
    assert.equal(rethrowsOnly(new Function(`return ${src}`)()), true, src);
  for (const f of [(e: unknown) => console.error(e), function (e: unknown) { if (e) throw new Error("wrapped"); }, (e: Error) => { throw e.cause; }, "throw e"])
    assert.equal(rethrowsOnly(f), false, String(f));
});
