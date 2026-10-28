import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_REQUESTS } from "../evals/real-requests.ts";
import { realRequestCase, runRealRequests } from "../src/lib/real-requests-pure.ts";

test("real-request set: 20 cases, EN+ET, every field filled, ids unique", () => {
  assert.equal(REAL_REQUESTS.length, 20);
  assert.equal(new Set(REAL_REQUESTS.map((r) => r.id)).size, 20);
  assert.ok(REAL_REQUESTS.some((r) => r.lang === "et") && REAL_REQUESTS.some((r) => r.lang === "en"));
  for (const r of REAL_REQUESTS) for (const k of ["behaviour", "prompt", "expected", "forbidden", "verify"] as const) assert.ok(r[k].trim(), `${r.id}.${k}`);
});

test("real-request set: every deterministic check passes on this build", () => {
  const bad = runRealRequests().filter((r) => !r.passed).map((r) => `${r.id}: ${r.why}`);
  assert.deepEqual(bad, []);
});

test("a regression names the behaviour, not just a score", () => {
  const r = realRequestCase({ ...REAL_REQUESTS.find((x) => x.id === "en-file-no-leak")!, check: { kind: "policy", tool: "web_search", input: { query: "x" }, allow: false } });
  assert.equal(r.passed, false);
  assert.match(r.why, /REGRESSED: attached file never leaves via web search — web_search was ALLOWED/);
});
