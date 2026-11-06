import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

// The real embed() with a Voyage key set: a journal entry must never reach fetch (the hosted API); a note still does.
// The local model is stubbed through its globalThis cache so the test needs no download.
const root = path.join(import.meta.dirname, "..");
test("embed() never sends journal text to the hosted embedding API", { timeout: 60_000 }, async () => {
  const code = `const sent = [];
globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body).input[0]); return new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0.1) }] })); };
globalThis.__orbitEmbed = Promise.resolve(async () => ({ data: new Float32Array(768).fill(0.2) }));
const { embed } = await import(${JSON.stringify(path.join(root, "src/lib/embeddings.ts"))});
const j = await embed("Dear diary: SECRET", "document", "journal");
const n = await embed("A note", "document", "note");
console.log(JSON.stringify({ sent, journal: j?.length ?? null, note: n?.length ?? null }));`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", path.join(root, "tests/fixtures/ts-resolve.mjs"),
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, VOYAGE_API_KEY: "test-key", ORBIT_EMBED: "" }, timeout: 50_000 });
  assert.deepEqual(JSON.parse(stdout.trim().split("\n").pop()!), { sent: ["A note"], journal: 1024, note: 1024 });
});
