import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// The 2026-11-06 briefing crash, end to end inside one server-like child process: the crash policy (crash-log.ts), the real voice
// model's phonemizer loaded the way ORBIT loads it (its own child process, clips/kokoro-worker.mjs), a briefing whose feed answers
// with a cut-off gzip error page plus a stray stream error escaping that briefing, then a briefing whose feed works.
const root = path.resolve(import.meta.dirname, "..");
const run = (code: string, env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
  "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ...env }, timeout: 90_000 }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code as number, stdout: e.stdout as string, stderr: e.stderr as string }));

const SERVER = `
import http from "node:http"; import { fork } from "node:child_process"; import { createGunzip, gzipSync } from "node:zlib";
process.on("uncaughtException", (e) => console.log("RAW " + e.message)); // Next's raw-printing handler, replaced at boot
const { logCrashes, asJob } = await import("@/lib/crash-log"); logCrashes();
const { pinnedGet } = await import("@/lib/memory"); const { parseFeed } = await import("@/lib/pure");
const handlers = () => process.listenerCount("uncaughtException") + process.listenerCount("unhandledRejection");
// the voice model as ORBIT loads it: phonemizer is evaluated in the voice process
const before = handlers();
const w = fork(${JSON.stringify(path.join(root, "src/lib/clips/kokoro-worker.mjs"))}, [], { serialization: "advanced", execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] }); w.on("error", () => {});
await new Promise((ok) => w.on("message", (m) => m.loaded && ok()));
w.kill(); // its model would load next; this test only needs phonemizer evaluated
console.log("phonemizer loaded; server-thread error handlers added: " + (handlers() - before));
const rss = gzipSync(Buffer.from('<rss><channel><item><title>Godot 5 released</title><link>https://example.com/a</link><description>news</description></item></channel></rss>'));
const srv = http.createServer((q, r) => {
  if (q.url === "/broken") { r.writeHead(403, { "content-encoding": "gzip" }); r.end(rss.subarray(0, 20)); } // cut-off compressed error page
  else { r.writeHead(200, { "content-encoding": "gzip", "content-type": "application/rss+xml" }); r.end(rss); }
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const get = (p) => pinnedGet(new URL("http://127.0.0.1:" + srv.address().port + p), { address: "127.0.0.1", family: 4 }, {}, 1e6, AbortSignal.timeout(5000));
`;

test("a cut-off compressed error page is a failed feed, caught at the fetch: no uncaught error, the next briefing succeeds; phonemizer never touches the server's handlers", { timeout: 120_000 }, async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  const r = await run(`${SERVER}
const first = await asJob("briefing:midday", async () => (await get("/broken")).status);
console.log("first briefing: feed answered " + first);
await new Promise((ok) => setTimeout(ok, 500)); // the old fetcher's unread decoder failed about here
const items = await asJob("briefing:evening", async () => { const res = await get("/feed.xml"); return parseFeed(new TextDecoder().decode(res.body)).items.length; });
console.log("second briefing: " + items + " article(s)");
await new Promise((ok) => setTimeout(ok, 300));
console.log("still serving"); process.exit(0);`, { ORBIT_DATA_DIR: d });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /phonemizer loaded; server-thread error handlers added: 0/);
  assert.match(r.stdout, /first briefing: feed answered 403/);
  assert.match(r.stdout, /second briefing: 1 article\(s\)/);
  assert.match(r.stdout, /still serving/);
  assert.doesNotMatch(r.stdout, /RAW /);
  assert.doesNotMatch(r.stderr, /uncaughtException/, "nothing escaped the fetch boundary");
  await assert.rejects(readFile(path.join(d, "crash.log"), "utf8"), "no crash.log entry at all");
});

test("a network/stream error that still escapes a briefing uncaught stops ORBIT, logged first with the job", { timeout: 120_000 }, async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  const r = await run(`${SERVER}
void asJob("briefing:midday", async () => { createGunzip().end(Buffer.from([0x1f, 0x8b, 8, 0])); }); // a stray stream nobody listens to
setTimeout(() => { console.log("NOT STOPPED"); process.exit(0); }, 4000);`, { ORBIT_DATA_DIR: d });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stdout, /NOT STOPPED/);
  assert.match(r.stderr, /\[orbit\] uncaughtException \(fatal: ORBIT stops now and its launcher restarts it\)/);
  assert.match(await readFile(path.join(d, "crash.log"), "utf8"), /uncaughtException in briefing:midday Z_BUF_ERROR Error: unexpected end of file\n\s+at [\s\S]*→ fatal/);
});

test("a bug inside a briefing (not a network error) still stops ORBIT, logged first", { timeout: 120_000 }, async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  const r = await run(`${SERVER}
void asJob("briefing:midday", async () => { setTimeout(() => { null.items; }, 10); });
setTimeout(() => { console.log("NOT STOPPED"); process.exit(0); }, 4000);`, { ORBIT_DATA_DIR: d });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stdout, /NOT STOPPED/);
  assert.match(r.stderr, /\[orbit\] uncaughtException \(fatal: ORBIT stops now and its launcher restarts it\)/);
  assert.match(await readFile(path.join(d, "crash.log"), "utf8"), /uncaughtException in briefing:midday {2}TypeError: Cannot read properties of null[^\n]*\n\s+at [\s\S]*→ fatal/);
});

test("phonemizer's handlers are real: loaded in the server's process they would end it on any error (why it lives in its own)", { timeout: 120_000 }, async () => {
  // Next's own forgiving handler stands in for the server (ORBIT's crash-log sweep would remove phonemizer's depending on timing).
  const server = (withPhonemizer: boolean) => run(`
process.on("unhandledRejection", (e) => console.log("logged: " + e.message));
${withPhonemizer ? 'await import("phonemizer");' : ""}
setTimeout(() => Promise.reject(new Error("a forgotten await")), 10);
setTimeout(() => { console.log("still serving"); process.exit(0); }, 800);`);
  const plain = await server(false), loaded = await server(true);
  assert.equal(plain.code, 0, "control: the forgiving handler keeps the server up");
  assert.match(plain.stdout, /logged: a forgotten await[\s\S]*still serving/);
  assert.notEqual(loaded.code, 0, "with phonemizer in the process the same rejection ends it");
  assert.doesNotMatch(loaded.stdout, /still serving/);
});

test("the voice process: one that dies fails its waiting request and the next request starts a fresh one", { timeout: 60_000 }, async () => {
  const r = await run(`
import { writeFileSync, mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
const { startKokoro } = await import("@/lib/clips/kokoro");
const dir = mkdtempSync(path.join(tmpdir(), "kw-")), f = path.join(dir, "w.mjs");
writeFileSync(f, 'process.send({ ready: true }); process.on("message", (m) => { if (m.text === "die") process.exit(3); process.send({ id: m.id, audio: new Float32Array([0.5, -0.5]), rate: 24000 }); });');
let gone = 0;
const k = await startKokoro(f, () => gone++);
const ok = await k.generate("hello", { voice: "af_heart" });
const died = await k.generate("die", { voice: "af_heart" }).then(() => "no", (e) => e.message);
const again = await (await startKokoro(f)).generate("hello", { voice: "af_heart" });
console.log(JSON.stringify({ samples: ok.audio.length, died, gone, again: again.audio.length, float: ok.audio instanceof Float32Array }));`);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split("\n").pop()!), { samples: 2, died: "The voice model stopped (exit 3)", gone: 1, again: 2, float: true });
});
