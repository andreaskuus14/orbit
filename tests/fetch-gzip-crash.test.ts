// A site answering a redirect or an error with a gzip body: ORBIT's pinned GET (memory.ts) drops that body. It used to start
// decoding it first, so the dropped stream threw Z_BUF_ERROR ("unexpected end of file") uncaught and killed the server (#407).
// Runs the real pinnedGet in a child process; the crash logger (crash-log.ts) is checked the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const child = (code: string, env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href, // a URL: Windows rejects D:\ paths here
  "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ...env }, timeout: 60_000 });

test("a redirect or error page with a gzip body doesn't crash the server", async () => {
  const { stdout } = await child(`
import http from "node:http"; import { gzipSync } from "node:zlib";
const { pinnedGet } = await import("@/lib/memory");
const full = gzipSync(Buffer.from("x".repeat(200_000)));
const srv = http.createServer((q, r) => { r.writeHead(q.url === "/moved" ? 302 : 500, { "content-encoding": "gzip", location: "/elsewhere" }); r.end(full.subarray(0, full.length >> 1)); });
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const out = [];
for (const p of ["/moved", "/broken"]) out.push((await pinnedGet(new URL("http://127.0.0.1:" + srv.address().port + p), { address: "127.0.0.1", family: 4 }, {}, 1e6, AbortSignal.timeout(5000))).status);
await new Promise((ok) => setTimeout(ok, 500)); // a late decoder error would land here
console.log(JSON.stringify(out)); srv.close(); process.exit(0);`);
  assert.deepEqual(JSON.parse(stdout.trim().split("\n").pop()!), [302, 500]);
});

test("crash logging keeps the stack and never the credentials; a stray rejection keeps serving, an uncaught exception stops ORBIT", async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-crash-"));
  const secret = "sb_secret_Zx9" + "q".repeat(30);
  const msg = `unexpected end of file fetching https://bob:hunter2pass@api.example.com/v1?api_key=AKIA1234567890&page=2 Authorization: Bearer abcdefghijklmnop1234 jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 ${secret} re_123456789abcdefghijklmn`;
  const r = await child(`
process.on("uncaughtException", (e) => { console.error("RAW " + e.message); }); // stands in for Next's handler (raw message)
const { logCrashes } = await import("@/lib/crash-log"); logCrashes();
setTimeout(() => { Promise.reject(new Error("rejected with token=SECRETTOKEN123456")); }, 10);
setTimeout(() => { Promise.reject({ $$typeof: Symbol.for("react.postpone") }); }, 30);
setTimeout(() => console.log("served after the rejection"), 60);
setTimeout(() => { throw Object.assign(new Error(${JSON.stringify(msg)}), { code: "Z_BUF_ERROR" }); }, 100); // outside any job: fatal
setTimeout(() => console.log("still serving 0.5 s later (in-flight work finishes)"), 600);
setTimeout(() => { console.log("NOT STOPPED"); process.exit(0); }, 4000);`, { ORBIT_DATA_DIR: d, SUPABASE_SECRET_KEY: secret }).then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));
  assert.match(r.stdout, /served after the rejection/, "an unhandled rejection is logged and the server keeps serving");
  assert.match(r.stdout, /still serving 0\.5 s later/, "a controlled stop: a short grace first");
  assert.doesNotMatch(r.stdout, /NOT STOPPED/);
  assert.equal(r.code, 1, "an uncaught exception stops ORBIT with exit 1 (launch.ps1 restarts it)");
  assert.doesNotMatch(r.stderr, /RAW /, "the raw-printing handler was replaced");
  assert.match(r.stderr, /\[orbit\] uncaughtException \(fatal: ORBIT stops now and its launcher restarts it\)/);
  const log = await readFile(path.join(d, "crash.log"), "utf8");
  assert.match(log, /uncaughtException Z_BUF_ERROR Error: unexpected end of file fetching https:\/\/\[credentials\]@api\.example\.com\/v1\?api_key=\[redacted\]&page=2/);
  assert.match(log, /Error: unexpected end of file[^\n]*\n\s+at /, "the stack frames are kept");
  assert.match(log, /unhandledRejection {2}Error: rejected with token=\[redacted\]\n\s+at /);
  assert.equal(log.match(/^\S+ (uncaughtException|unhandledRejection) /gm)?.length, 2, "the React postpone isn't logged");
  for (const leak of ["hunter2pass", "AKIA1234567890", "abcdefghijklmnop1234", "eyJhbGciOiJIUzI1", secret, "re_123456789abcdefghijklmn", "SECRETTOKEN123456"]) {
    assert.ok(!log.includes(leak), `crash.log leaks ${leak}`);
    assert.ok(!r.stderr.includes(leak), `console leaks ${leak}`);
  }
  assert.match(log, /\[SUPABASE_SECRET_KEY\]/, "a configured secret is named, not shown");
});

test("crashVerdict: only a network/stream error inside a briefing job is survivable; rejections keep serving", async () => {
  const { crashVerdict } = await import("../src/lib/crash-log.ts");
  const err = (code?: string) => Object.assign(new Error("x"), code ? { code } : {});
  assert.equal(crashVerdict("uncaughtException", err("Z_BUF_ERROR"), "briefing:midday"), "job-failed");
  assert.equal(crashVerdict("uncaughtException", err("ECONNRESET"), "briefing:manual"), "job-failed");
  assert.equal(crashVerdict("uncaughtException", err("ERR_STREAM_PREMATURE_CLOSE"), "briefing:evening"), "job-failed");
  assert.equal(crashVerdict("uncaughtException", new TypeError("x is undefined"), "briefing:midday"), "fatal"); // a bug, not the network
  assert.equal(crashVerdict("uncaughtException", err("Z_BUF_ERROR"), null), "fatal"); // outside a job: unknown state
  assert.equal(crashVerdict("uncaughtException", err("ECONNRESET"), "agent:nova"), "fatal"); // only briefings are listed
  assert.equal(crashVerdict("unhandledRejection", new TypeError("x"), null), "keep-serving");
});
