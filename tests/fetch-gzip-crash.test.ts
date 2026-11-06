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

test("an uncaught error is logged with its stack before the server exits", async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-crash-"));
  const r = await child(`const { logCrashes } = await import("@/lib/crash-log"); logCrashes(); setTimeout(() => { throw Object.assign(new Error("unexpected end of file"), { code: "Z_BUF_ERROR" }); }, 10);`, { ORBIT_DATA_DIR: d })
    .then(() => ({ code: 0, stderr: "" }), (e) => ({ code: e.code as number, stderr: String(e.stderr) }));
  assert.notEqual(r.code, 0, "the process still exits");
  assert.match(r.stderr, /\[orbit\] server stopping on an uncaught error \(uncaughtException\)/);
  const log = await readFile(path.join(d, "crash.log"), "utf8");
  assert.match(log, /uncaughtException Z_BUF_ERROR Error: unexpected end of file\n\s+at /);
});
