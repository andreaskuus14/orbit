// A site answering a redirect or an error with a gzip body: ORBIT's pinned GET (memory.ts) drops that body. It used to start
// decoding it first, so the dropped stream threw Z_BUF_ERROR ("unexpected end of file") uncaught and killed the server (#407).
// Runs the real pinnedGet in a child process; the crash logger (crash-log.ts) is checked the same way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const child = (code: string, env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", path.join(root, "tests/fixtures/ts-resolve.mjs"),
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

test("uncaught errors and rejections are logged with their stack, without credentials, and the server keeps running", async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-crash-"));
  const secret = "sb_secret_Zx9" + "q".repeat(30);
  const msg = `unexpected end of file fetching https://bob:hunter2pass@api.example.com/v1?api_key=AKIA1234567890&page=2 Authorization: Bearer abcdefghijklmnop1234 jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4 ${secret} re_123456789abcdefghijklmn`;
  const r = await child(`
process.on("uncaughtException", (e) => { console.error("RAW " + e.message); }); // stands in for Next's handler (raw message)
const { logCrashes } = await import("@/lib/crash-log"); logCrashes();
setTimeout(() => { throw Object.assign(new Error(${JSON.stringify(msg)}), { code: "Z_BUF_ERROR" }); }, 10);
setTimeout(() => { Promise.reject(new Error("rejected with token=SECRETTOKEN123456")); }, 30);
setTimeout(() => { Promise.reject({ $$typeof: Symbol.for("react.postpone") }); }, 50);
setTimeout(() => { console.log("still running"); process.exit(0); }, 300);`, { ORBIT_DATA_DIR: d, SUPABASE_SECRET_KEY: secret });
  assert.match(r.stdout, /still running/, "the server keeps serving");
  assert.doesNotMatch(r.stderr, /RAW /, "the raw-printing handler was replaced");
  assert.match(r.stderr, /\[orbit\] uncaughtException \(server keeps running\)/);
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

test("loading kokoro-js (phonemizer) leaves no process-wide error handlers that rethrow", async () => {
  const { stdout } = await child(`
const n = () => process.listenerCount("uncaughtException") + process.listenerCount("unhandledRejection");
const { importWithoutProcessHandlers } = await import("@/lib/crash-log");
const before = n();
const m = await importWithoutProcessHandlers(() => import("kokoro-js"));
const guarded = n() - before;
const raw = await import("node:child_process").then((cp) => cp.execFileSync(process.execPath, ["--input-type=module", "-e", 'const n = () => process.listenerCount("uncaughtException") + process.listenerCount("unhandledRejection"); const b = n(); await import("kokoro-js"); console.log(n() - b)'], { encoding: "utf8" }).trim());
console.log(JSON.stringify({ loaded: typeof m.KokoroTTS, guarded, raw: Number(raw) }));`);
  const got = JSON.parse(stdout.trim().split("\n").pop()!);
  assert.equal(got.loaded, "function");
  assert.ok(got.raw >= 2, `a plain import adds phonemizer's handlers (added ${got.raw})`);
  assert.equal(got.guarded, 0, "the guarded import adds none");
});
