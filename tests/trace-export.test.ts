import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, traceExport, type TaskRow } from "../src/lib/trace-export-pure.ts";

// Fake secrets only; assembled at runtime so the secret scanner (scripts/secret-scan.mjs) doesn't flag this file.
const J = (...p: string[]) => p.join("");
const FAKE = {
  openai: J("sk-", "proj-FAKEfakeFAKEfake1234567890"), gh: J("ghp_", "FAKEfakeFAKEfakeFAKEfake1234"), aws: J("AKIA", "FAKEFAKEFAKEFAKE"),
  sb: J("sb_secret_", "FAKEfakeFAKEfake123"), jwt: J("eyJhbGciOiJIUzI1NiJ9", ".eyJzdWIiOiJmYWtlIn0", ".c2lnbmF0dXJlZmFrZQ"),
  pem: J("-----BEGIN PRIVATE", " KEY-----\nMIIEfakeFAKEfake\n-----END PRIVATE", " KEY-----"),
};
const LIFE = "Dear journal, today I felt anxious about the exam";
const RAW = "SYSTEM PROMPT: you are ORBIT and the owner's secret plan is X";

const row = (o: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1", parent_id: null, agent: "atlas", title: "Research saunas", request: `${RAW}\n${LIFE}`, status: "done", result: `Answer quoting ${LIFE}`,
  error: `fetch failed: Authorization: Bearer ${FAKE.openai}`, created_at: "2026-11-10T10:00:00Z", started_at: null, finished_at: null,
  trace: [
    { step: "web_search", detail: `query ok token=${FAKE.gh}`, ms: 120, ok: true },
    { step: "search_memory", detail: `found: ${LIFE}`, ms: 5, ok: true },
    { step: "journal_read", detail: LIFE, ms: 3, ok: true },
    { step: "source", detail: "read page", ms: 40, ok: true, url: "https://example.test/pricing?key=abc123" },
    { step: "think", detail: `env: ${FAKE.aws} ${FAKE.sb} ${FAKE.jwt} mail me at owner@example.test or +372 5555 1234, IBAN EE38 2200 2210 2014 5685, file C:\\Users\\andreas\\Documents\\plan.txt`, ms: 900, ok: true },
  ],
  pending: [{ tool: "send_email", input: { to: "client@example.test", body: `Hi ${LIFE}` }, status: "pending" }], ...o,
});

test("S07: fake secrets, the raw prompt, LIFE text and tokens never appear in the export", () => {
  const out = JSON.stringify(traceExport([row(), row({ id: "t2", parent_id: "t1", agent: "qa" })], "2026-11-10T12:00:00Z"));
  for (const bad of [...Object.values(FAKE), LIFE, RAW, "anxious", "owner@example.test", "client@example.test", "5555 1234", "EE38 2200", "andreas", "abc123", "secret plan"])
    assert.ok(!out.includes(bad), `leaked: ${bad.slice(0, 30)}`);
  const t = JSON.parse(out).tasks[0];
  assert.equal(t.request, `[${row().request.length} characters omitted]`);
  assert.deepEqual(t.steps.map((s: { step: string }) => s.step), ["web_search", "search_memory", "journal_read", "source", "think"], "the run's shape stays");
  assert.equal(t.steps[3].site, "example.test");
  assert.deepEqual(t.pending, [{ tool: "send_email", status: "pending", fields: ["to", "body"] }]);
});

test("redactText: each secret shape is replaced, ordinary text stays", () => {
  for (const s of Object.values(FAKE)) assert.ok(!redactText(`x ${s} y`).includes(s), s.slice(0, 12));
  assert.equal(redactText("OPENAI_API_KEY=whatever123").includes("whatever123"), false, ".env lines");
  assert.equal(redactText("Opened 3 pages in 1.2 s, all fine"), "Opened 3 pages in 1.2 s, all fine");
  assert.equal(redactText("Year 2026, step 12"), "Year 2026, step 12", "short numbers aren't phone numbers");
});
