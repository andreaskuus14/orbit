import { test } from "node:test";
import assert from "node:assert/strict";
import { DIM, gemmaInput, padTo, provider } from "../src/lib/embeddings-pure.ts";

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
