import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// safeFetch's pinnedGet against a local server sending cut-off gzip bodies (what a proxy's or site's broken error page looks like).
// 2026-11-06: a 403 with a cut-off gzip body made the unread decoder emit "unexpected end of file" with no listener, an uncaught
// exception that ended the server during the midday briefing. Each case runs in a child so an uncaught error can't be hidden.
const root = path.join(import.meta.dirname, "..");
const run = (mode: string) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
  "--input-type=module", "-e", `
import http from "node:http"; import { gzipSync } from "node:zlib";
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
process.on("uncaughtException", (e) => out({ uncaught: e.code ?? e.message }));
const full = gzipSync(Buffer.from("<rss>" + "x".repeat(200000) + "</rss>"));
const srv = http.createServer((q, s) => {
  s.writeHead(${JSON.stringify(mode)}.startsWith("403") ? 403 : 200, { "content-encoding": "gzip", "content-type": "application/rss+xml" });
  if (${JSON.stringify(mode)}.endsWith("whole")) s.end(full); else { s.write(full.subarray(0, 40)); s.end(); } // 40 bytes: header + a little data
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok)); // bound before its port is read (Windows imports fast enough to win the race)
const { pinnedGet } = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/memory.ts")).href)});
const r = await pinnedGet(new URL("http://127.0.0.1:" + srv.address().port + "/feed"), { address: "127.0.0.1", family: 4 }, {}, 3_000_000, AbortSignal.timeout(5000))
  .then((x) => ({ status: x.status, bytes: x.body.length }), (e) => ({ rejected: e.code ?? e.message }));
await new Promise((ok) => setTimeout(ok, 500)); // an unread decoder fails a moment later
out(r);`], { cwd: root, timeout: 50_000 }).then((r) => JSON.parse(r.stdout.trim().split("\n").pop()!));

test("an error page with a cut-off gzip body is answered with its status, never an uncaught exception", { timeout: 60_000 }, async () => {
  assert.deepEqual(await run("403-cut"), { status: 403, bytes: 0 });
});

test("a cut-off gzip body on a 200 is an error the caller gets (not swallowed); a whole one decodes", { timeout: 60_000 }, async () => {
  assert.deepEqual(await run("200-cut"), { rejected: "Z_BUF_ERROR" });
  assert.deepEqual(await run("200-whole"), { status: 200, bytes: 200011 });
});
