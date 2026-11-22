// ORBIT code sandbox, JavaScript side (src/lib/sandbox.ts starts it; rules in src/lib/sandbox-pure.ts).
//   node --permission --allow-fs-read=<run folder>,<this file> --allow-fs-write=<run folder> --max-old-space-size=<MB> run.mjs <limits.json>
// Node's permission model blocks files outside the run folder, child processes, workers, native addons and the inspector.
// Node has no network switch, so the network is removed here before main.js runs: fetch/WebSocket/EventSource are deleted,
// process.binding is gone and require() refuses every network/process module. main.js runs as a plain script (vm), so it
// can't import() anything either. Plain JS for numbers and text; charts are made in Python.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const limits = JSON.parse(readFileSync(process.argv[2], "utf8"));
const work = process.cwd();
const wall = setTimeout(() => { process.stderr.write(`\n[sandbox] stopped: the ${limits.wallSec}-second time limit was reached\n`); process.exit(124); }, (limits.wallSec ?? 30) * 1000);
wall.unref();

const BLOCKED = new Set(["net", "tls", "http", "https", "http2", "dgram", "dns", "child_process", "cluster", "worker_threads", "inspector", "repl", "vm", "module", "v8", "wasi", "trace_events", "diagnostics_channel", "async_hooks", "perf_hooks", "undici"]);
const real = createRequire(path.join(work, "main.js"));
const safeRequire = (id) => {
  const name = String(id).replace(/^node:/, "").split("/")[0];
  if (BLOCKED.has(name)) throw new Error(`blocked in the sandbox: '${id}' (no network, no other programs)`);
  if (!/^(fs|path|util|os|crypto|events|stream|string_decoder|buffer|url|querystring|assert|zlib|readline|timers)$/.test(name)) throw new Error(`not available in the sandbox: '${id}' (only Node's own fs, path, util, crypto, zlib and similar)`);
  return real(`node:${name}`);
};
for (const k of ["fetch", "WebSocket", "EventSource", "Request", "Response", "Headers", "FormData", "navigator", "BroadcastChannel", "MessageChannel", "Worker"]) {
  try { delete globalThis[k]; } catch { globalThis[k] = undefined; }
}
for (const k of ["binding", "_linkedBinding", "getBuiltinModule", "dlopen", "kill", "_debugProcess", "send", "openStdin"]) {
  try { Object.defineProperty(process, k, { value: undefined, configurable: false, writable: false }); } catch { /* not there */ }
}

const file = path.join(work, "main.js");
const code = readFileSync(file, "utf8");
const g = Object.assign(globalThis, { require: safeRequire, __filename: file, __dirname: work, module: { exports: {} } });
try {
  const res = vm.runInThisContext(`(async () => {\n${code}\n})()`, { filename: "main.js", lineOffset: -1 });
  await res;
  void g;
} catch (e) {
  process.stderr.write(`${e && e.stack ? String(e.stack).split(work + path.sep).join("") : String(e)}\n`);
  process.exitCode = 1;
}
try { writeFileSync(path.join(work, ".done"), ""); } catch { /* fine */ }
