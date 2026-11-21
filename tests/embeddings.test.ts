import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  checkModelFiles,
  DIM,
  gemmaInput,
  isCorruptModelError,
  LOCAL_EMBED_FILES,
  padTo,
  provider,
  type ModelFileSpec,
} from "../src/lib/embeddings-pure.ts";

test("provider: explicit setting, else Voyage only when a key exists", () => {
  assert.equal(provider({}), "local");
  assert.equal(provider({ VOYAGE_API_KEY: "k" }), "voyage");
  assert.equal(provider({ VOYAGE_API_KEY: "k", ORBIT_EMBED: "local" }), "local");
  assert.equal(provider({ ORBIT_EMBED: "voyage" }), "local"); // no key: can't use it
});

test("padTo keeps cosine: zero-pads to 1024, rejects bad vectors", () => {
  const v = padTo([0.6, 0.8])!;
  assert.equal(v.length, DIM); assert.deepEqual(v.slice(0, 3), [0.6, 0.8, 0]);
  assert.equal(padTo([]), null); assert.equal(padTo([NaN]), null); assert.equal(padTo(new Array(2000).fill(0)), null);
  assert.match(gemmaInput("x", "query"), /^task: search result \| query: x$/);
  assert.match(gemmaInput("x", "document"), /^title: none \| text: x$/);
});

test("a journal entry is always embedded locally, even when Voyage is the provider (journal text never leaves ORBIT)", () => {
  assert.equal(provider({ VOYAGE_API_KEY: "k" }, "journal"), "local");
  assert.equal(provider({ VOYAGE_API_KEY: "k", ORBIT_EMBED: "voyage" }, "journal"), "local");
  assert.equal(provider({ VOYAGE_API_KEY: "k" }, "note"), "voyage");
});

test("journal vectors are comparable only when every memory is embedded locally", async () => {
  const { journalsComparable } = await import("../src/lib/embeddings-pure.ts");
  assert.equal(journalsComparable({}), true);
  assert.equal(journalsComparable({ VOYAGE_API_KEY: "k" }), false);
  assert.equal(journalsComparable({ VOYAGE_API_KEY: "k", ORBIT_EMBED: "local" }), true);
  assert.equal(journalsComparable({ ORBIT_EMBED: "voyage" }), true); // no key: everything falls back to local
});

test("checkModelFiles detects missing, partial, truncated, hash-corrupt, and valid local ONNX weights", () => {
  const [onnx, data] = LOCAL_EMBED_FILES;
  assert.deepEqual(checkModelFiles({}), { status: "missing" });
  assert.deepEqual(checkModelFiles({ [onnx.relPath]: null, [data.relPath]: null }), { status: "missing" });

  // Exact failure seen in live ORBIT logs: truncated external weights (241,876,992 vs 308,890,624)
  assert.deepEqual(
    checkModelFiles({
      [onnx.relPath]: { size: onnx.size, sha256: onnx.sha256 },
      [data.relPath]: { size: 241_876_992 },
    }),
    { status: "corrupt", file: data.relPath, reason: "size" },
  );

  // Only one of the two required files present
  assert.deepEqual(
    checkModelFiles({ [onnx.relPath]: { size: onnx.size, sha256: onnx.sha256 }, [data.relPath]: null }),
    { status: "corrupt", file: data.relPath, reason: "partial" },
  );

  // Right size, corrupted bytes
  assert.deepEqual(
    checkModelFiles({
      [onnx.relPath]: { size: onnx.size, sha256: onnx.sha256 },
      [data.relPath]: { size: data.size, sha256: "0".repeat(64) },
    }),
    { status: "corrupt", file: data.relPath, reason: "hash" },
  );

  // Valid (case-insensitive hex)
  assert.deepEqual(
    checkModelFiles({
      [onnx.relPath]: { size: onnx.size, sha256: onnx.sha256.toUpperCase() },
      [data.relPath]: { size: data.size, sha256: data.sha256 },
    }),
    { status: "ok" },
  );
});

test("isCorruptModelError recognises ONNX truncation/deserialization failures and ignores unrelated errors", () => {
  assert.equal(
    isCorruptModelError(
      new Error(
        "Deserialize tensor model.layers.15.attn.v_proj.MatMul.weight_quantized failed. External initializer: offset: 266567680 size to read: 196608 given file_length: 241876992 are out of bounds or can not be read in full.",
      ),
    ),
    true,
  );
  assert.equal(isCorruptModelError(new Error("Protobuf parsing failed")), true);
  assert.equal(isCorruptModelError(new Error("Unexpected end of JSON input")), true);
  assert.equal(isCorruptModelError(new Error("fetch failed: ECONNREFUSED")), false);
  assert.equal(isCorruptModelError(null), false);
});

test("inspectModelCache verifies real files on disk via size and streaming SHA-256", { timeout: 30_000 }, async () => {
  const root = path.join(import.meta.dirname, "..");
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-embed-test-"));
  try {
    const content = Buffer.from("fake-onnx-weights-payload");
    const specs: ModelFileSpec[] = [
      { relPath: "onnx/model.onnx", size: content.length, sha256: createHash("sha256").update(content).digest("hex") },
    ];
    const run = async () => {
      const code = `const { inspectModelCache } = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/embeddings.ts")).href)});
console.log(JSON.stringify(await inspectModelCache(${JSON.stringify(dir)}, ${JSON.stringify(specs)})));`;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href, "--input-type=module", "-e", code],
        { cwd: root, timeout: 25_000 },
      );
      return JSON.parse(stdout.trim().split("\n").pop()!);
    };

    assert.deepEqual(await run(), { status: "missing" });

    await mkdir(path.join(dir, "onnx"), { recursive: true });
    const file = path.join(dir, "onnx", "model.onnx");

    // Truncated file
    await writeFile(file, content.subarray(0, 10));
    assert.deepEqual(await run(), { status: "corrupt", file: "onnx/model.onnx", reason: "size" });

    // Same length, flipped byte -> hash mismatch
    const bad = Buffer.from(content);
    bad[0] ^= 0xff;
    await writeFile(file, bad);
    assert.deepEqual(await run(), { status: "corrupt", file: "onnx/model.onnx", reason: "hash" });

    // Exact match
    await writeFile(file, content);
    assert.deepEqual(await run(), { status: "ok" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
