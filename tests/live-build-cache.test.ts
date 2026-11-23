// The live build (scripts/launch.ps1) builds into .next-build and reuses .next's webpack cache. Next puts the server-actions
// key (cache/.rscinfo) into the webpack cache version, so the cache only hits when that key comes along too. Without it
// every live build ran cold (10-13 min on the laptop). These checks fail if launch.ps1 or a Next upgrade breaks that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const req = createRequire(path.join(root, "package.json"));
const launch = readFileSync(path.join(root, "scripts/launch.ps1"), "utf8");
const updateRelease = launch.slice(launch.indexOf("function Update-Release"), launch.indexOf("npm.cmd run build"));

test("launch.ps1 carries the webpack cache and the server-actions key into .next-build before building", () => {
  assert.match(updateRelease, /Join-Path \$distLive "cache\\webpack"/);
  assert.match(updateRelease, /Join-Path \$distLive "cache\\\.rscinfo"/);
  assert.match(updateRelease, /Copy-Item -LiteralPath \$rscInfo -Destination \(Join-Path \$distNew "cache\\\.rscinfo"\)/);
});

test("Next still keys the webpack cache on the server-actions key and keeps that key in <distDir>/cache/.rscinfo", () => {
  const webpackConfig = readFileSync(req.resolve("next/dist/build/webpack-config.js"), "utf8");
  const vars = webpackConfig.slice(webpackConfig.indexOf("const configVars = JSON.stringify("), webpackConfig.indexOf("const cache = {"));
  assert.match(vars, /serverReferenceHashSalt: encryptionKey/);
  assert.match(webpackConfig, /cacheDirectory: _path\.default\.join\(distDir, 'cache', 'webpack'\)/);
  const keyStore = readFileSync(req.resolve("next/dist/server/app-render/encryption-utils-server.js"), "utf8");
  assert.match(keyStore, /const CONFIG_FILE = '\.rscinfo'/);
  const cacheDir = readFileSync(req.resolve("next/dist/server/cache-dir.js"), "utf8");
  assert.match(cacheDir, /join\(distDir, 'cache'\)/);
});

test("the fast live build skips file tracing, and Next still turns a '*' exclude into a tracer-wide ignore", () => {
  const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
  const fast = config.slice(config.indexOf('process.env.ORBIT_FAST_PROD_BUILD === "1"'), config.indexOf("async headers()"));
  assert.match(fast, /outputFileTracingExcludes: \{ "\*": \["\*\*\/\*"\] \}/);
  const traces = readFileSync(req.resolve("next/dist/build/collect-build-traces.js"), "utf8");
  assert.match(traces, /\(0, _picomatch\.default\)\(glob\)\('next-server'\)/); // a "*" key reaches the shared ignores...
  assert.match(traces, /\.\.\.additionalIgnores\s*\]/);
  assert.match(traces, /ignore \(p\) \{\s*if \(sharedIgnoresFn\(p\)\)/); // ...which the tracer checks before reading a file
});
