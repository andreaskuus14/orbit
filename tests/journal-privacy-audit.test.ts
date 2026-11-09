// H05 journal privacy audit: a planted journal marker must never reach a model prompt, a shared report or a notification.
// Paths already covered elsewhere are listed in the PR; this file covers the seams that had no test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildFailureReport } from "../src/lib/failure-report-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";

const MARK = "PLANTED-JOURNAL-7731";
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("failure report (default, personal off) never quotes the private text a policy refusal names", () => {
  const detail = `{"query":"${MARK}"} → Error: this web_search call would send private text out: "${MARK}" (from the user's private notes, journal or files).`;
  const agentDetail = `{"url":"x"} → Error: this URL would send private text from the task out ("${MARK}"); open a public URL without it.`;
  const r = buildFailureReport({ kind: "turn", id: "t1", at: "2026-11-08T10:00:00Z", trace: [
    { step: "web_search", detail, ok: false, policy: { verdict: "refuse" } },
    { step: "fetch_url", detail: agentDetail, ok: false, policy: { verdict: "refuse" } },
  ] });
  assert.equal(r.policyDecisions.length, 2); // the refusals are still reported
  assert.ok(!JSON.stringify(r).includes(MARK));
});

test("the policy refusal itself quotes the hit (so the report must mask it)", () => {
  const v = decide("web_search", { query: "Planted Kuusk" }, { stopAll: false, attach: false, pins: false, question: "hello", steps: ["You called life_journal {}\nRESULT:\nok"], privateText: [`Planted Kuusk owes 7731 € ${MARK}`] } as never);
  assert.equal(v.allow, false);
  assert.match(v.allow ? "" : v.reason, /"Planted Kuusk"/);
});

test("cloud-model readers exclude journal rows at the query (no journal text is even fetched)", async () => {
  for (const f of ["src/lib/core.ts", "src/lib/arch-digest.ts", "src/lib/memory-graph.ts", "src/lib/night-plan.ts", "src/lib/week.ts"])
    assert.match(src(f), /\.neq\("kind", "journal"\)/, f);
  assert.match(src("src/lib/morning.ts"), /not\("kind", "in", "\(conversation,journal\)"\)/);
  assert.match(src("src/lib/dream.ts"), /\.in\("kind", NOTE_KINDS\)/);
  const { NOTE_KINDS } = await import("../src/lib/dream-pure.ts");
  assert.ok(!NOTE_KINDS.includes("journal"));
});
