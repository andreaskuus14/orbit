import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFailureReport, errorCategory, reportFileName, traceChain } from "../src/lib/failure-report-pure.ts";

const trace = [
  { step: "search_memory", detail: "3 found", ms: 12, ok: true },
  { step: "save_memory", detail: '{"text":"my diary secret"} → saved', ms: 40, ok: true, evidence: [{ kind: "memory", id: "m1" }] },
  { step: "send_email", detail: '{"to":"a@b.com"} → Error: blocked by policy: needs owner approval', ms: 2, ok: false },
  { step: "web_fetch", detail: '{"url":"https://x.io/?token=abc123"} → Error: fetch failed', ms: 900, ok: false },
  { step: "think", detail: "smart · answering", ms: 500, ok: true, answerEval: { pass: false, flags: ["claims sent without evidence"] } },
];
const base = { kind: "turn" as const, id: "conv-1", trace, at: "2026-10-28T10:00:00Z", request: "email Bob my diary",
  answer: "Sent! key sk-ant-abcdefghijklmnop", error: "Authorization: Bearer abc.def.ghi failed", model: "smart", appVersion: "b1", relatedIds: ["conv-1", "conv-1", ""] };

test("default report excludes personal content and redacts credentials", () => {
  const r = buildFailureReport(base);
  const s = JSON.stringify(r);
  assert.ok(!s.includes("diary") && !s.includes("a@b.com") && !s.includes("abc123") && !s.includes("sk-ant") && !s.includes("abc.def"));
  assert.equal(r.personalIncluded, false);
  assert.equal("request" in r, false);
  assert.deepEqual(r.relatedIds, ["conv-1"]);
  assert.deepEqual(r.toolsCalled.map((t) => [t.attempt, t.tool, t.ok]), [[1, "save_memory", true], [2, "send_email", false], [3, "web_fetch", false]]);
  assert.deepEqual(r.toolsCalled[0].receipts, ["memory:m1"]);
  assert.equal(r.policyDecisions.length, 1);
  assert.equal(r.errorCategory, "policy");
});

test("include toggle adds content, still redacted", () => {
  const r = buildFailureReport(base, true);
  const s = JSON.stringify(r);
  assert.ok(s.includes("diary") && !s.includes("sk-ant-abc") && !s.includes("token=abc123") && !s.includes("a@b.com"));
});

test("trace chain names missing links", () => {
  const c = traceChain(trace, true);
  assert.equal(c.claim.pass, false);
  assert.ok(c.gaps.some((g) => g.includes("attempt 2 (send_email) failed by policy")));
  assert.ok(traceChain([{ step: "x", ok: true }], false).gaps.includes("final claim was not checked"));
  assert.ok(traceChain(null, false).gaps.includes("no intent (request) linked"));
  assert.ok(traceChain([{ step: "think", answerEval: { pass: false, flags: ["claims saved without evidence"] } }], true).gaps.includes("claim of an action without any receipt"));
});

test("bounded and categorised", () => {
  const big = Array.from({ length: 500 }, (_, i) => ({ step: "t", detail: `${i}`, ok: true }));
  const r = buildFailureReport({ ...base, trace: big, error: null });
  assert.equal(r.toolsCalled.length, 200);
  assert.equal(r.truncated, true);
  assert.equal(errorCategory("Request timed out"), "timeout");
  assert.equal(errorCategory("429 rate limit"), "rate_limit");
  assert.equal(errorCategory("Cancelled"), "cancelled");
  assert.equal(errorCategory(""), "unknown");
  assert.equal(reportFileName(r), "orbit-failure-turn-conv-1-2026-10-28.json");
});
