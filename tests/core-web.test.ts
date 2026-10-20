import { test } from "node:test";
import assert from "node:assert/strict";
import { webSearchQuery } from "../src/lib/core-web-pure.ts";

test("webSearchQuery cleans, caps and rejects empty input", () => {
  assert.deepEqual(webSearchQuery({ query: "  small\nbusinesses \t Rakvere " }), { query: "small businesses Rakvere" });
  assert.equal((webSearchQuery({ query: "x".repeat(500) }) as { query: string }).query.length, 200);
  assert.ok("error" in webSearchQuery({}));
  assert.ok("error" in webSearchQuery({ query: 42 }));
  assert.ok("error" in webSearchQuery({ query: "   " }));
});
