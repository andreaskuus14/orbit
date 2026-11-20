import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { createPool } from "../src/lib/asr-pool.ts";
import { DOWNLOAD_STALL_MS, PARAKEET, parakeetConfig, sherpaFiles } from "../src/lib/clips/parakeet-pure.ts";

const WORKER = path.join(import.meta.dirname, "..", "src", "lib", "clips", "parakeet-worker.mjs");

test("sherpaFiles: the JS package and this platform's addon (Windows is 'win', not 'win32')", () => {
  const j = (...p: string[]) => p.join("/");
  assert.deepEqual(sherpaFiles("/app", "win32", "x64", j), ["/app/node_modules/sherpa-onnx-node/package.json", "/app/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node"]);
  assert.equal(sherpaFiles("/app", "linux", "arm64", j)[1], "/app/node_modules/sherpa-onnx-linux-arm64/sherpa-onnx.node");
});

test("parakeetConfig: the model's int8 transducer files, 1-8 threads", () => {
  const c = parakeetConfig("/m/p", 15, (...p) => p.join("/"));
  assert.equal(c.modelConfig.transducer.encoder, "/m/p/encoder.int8.onnx");
  assert.equal(c.modelConfig.tokens, "/m/p/tokens.txt");
  assert.equal(c.modelConfig.numThreads, 8);
  assert.equal(parakeetConfig("/m", 0, (...p) => p.join("/")).modelConfig.numThreads, 1);
  for (const f of PARAKEET.files.filter((f) => f.endsWith(".onnx"))) assert.ok(Object.values(c.modelConfig.transducer).some((v) => v.endsWith(f)), f);
  assert.equal(DOWNLOAD_STALL_MS, 60_000);
});

test("the Parakeet worker never loads sherpa in the server process and survives a missing model", async () => {
  const pool = createPool(WORKER, 1, 30_000, "Parakeet");
  const config = parakeetConfig(path.join(import.meta.dirname, "no-such-model"), 1, path.join);
  // No model files: sherpa (if installed) refuses them, or the addon isn't there at all. Either way it's a rejection, not a server crash.
  await assert.rejects(pool.run({ config }, 60_000));
  assert.ok(!Object.keys((await import("node:module")).createRequire(import.meta.url).cache).some((k) => k.includes("sherpa-onnx")), "sherpa stays out of this process");
  pool.close();
});

// The real decode needs the 487 MB model: ORBIT_PARAKEET_TEST_DIR=<models dir that holds parakeet-tdt-0.6b-v3-int8>.
const real = process.env.ORBIT_PARAKEET_TEST_DIR;
test("real Parakeet decode in the child (opt-in)", { skip: !real || !existsSync(path.join(real, PARAKEET.dir)) }, async () => {
  const { execFileSync } = await import("node:child_process");
  const ff = (await import("ffmpeg-static")).default as unknown as string;
  const raw = execFileSync(ff, ["-v", "error", "-i", path.join(real!, PARAKEET.dir, "test_wavs", "en.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  const pool = createPool(WORKER, 1, 30_000, "Parakeet");
  const config = parakeetConfig(path.join(real!, PARAKEET.dir), 2, path.join);
  const r = (await pool.run({ config, audio: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) }, 120_000)) as { text: string; tokens: string[] };
  assert.match(r.text, /ask not what your country can do for you/i);
  assert.ok(r.tokens.length > 10);
  pool.close();
});
