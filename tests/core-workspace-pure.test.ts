import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelsJob, changeRequest, missionOf, turnArtifact } from "../src/lib/core-workspace-pure.ts";

test("turnArtifact: preview, diff, code, table, document, none", () => {
  assert.deepEqual(turnArtifact("Done. Preview: /w/abc.def/index.html Check: ok"), { kind: "preview", title: "Preview", body: "/w/abc.def/index.html", href: "/w/abc.def/index.html" });
  assert.equal(turnArtifact("```diff\n--- a\n+++ b\n-x\n+y\n```")?.kind, "diff");
  const code = turnArtifact("a\n```ts\nx\n```\n```py\nlonger body\n```");
  assert.equal(code?.kind, "code"); assert.equal(code?.body, "longer body"); assert.equal(code?.title, "py code");
  const t = turnArtifact("Here:\n| a | b |\n|---|---|\n| 1 | 2 |\nend");
  assert.equal(t?.kind, "table"); assert.equal(t?.body, "| a | b |\n|---|---|\n| 1 | 2 |");
  const doc = turnArtifact(`# Plan\n\n${"word ".repeat(150)}\n\nmore [m:1]`);
  assert.equal(doc?.kind, "document"); assert.equal(doc?.title, "Plan"); assert.ok(!doc?.body.includes("[m:1]"));
  assert.equal(turnArtifact("Short answer."), null);
});

test("changeRequest quotes the section and the instruction", () => {
  const r = changeRequest({ kind: "document", title: "Plan" }, "  para two ", " make it shorter ");
  assert.match(r, /"""\npara two\n"""/); assert.match(r, /Change: make it shorter$/);
});

test("missionOf: honest proof levels, blockers, waiting", () => {
  assert.equal(missionOf([], [], false, false).proof, null);
  assert.equal(missionOf([], [], false, true).proof, "prepared");
  const read = [{ step: "search_memory", detail: "3 found", ok: true }];
  assert.equal(missionOf(read).proof, "prepared");
  assert.equal(missionOf([...read, { step: "delegate", detail: "→ ok", ok: true }]).proof, "executed");
  const ev = [{ step: "ws_write", detail: "wrote", ok: true, evidence: [{ kind: "file" as const, id: "x" }] }];
  assert.equal(missionOf(ev).proof, "verified");
  const m = missionOf([{ step: "fallback", detail: "deep → main", ok: false }, { step: "send_email", detail: "Error: no", ok: false },
    { step: "delegate", detail: "result (awaiting_approval)", ok: true }], ["Reading", "Writing"], true);
  assert.deepEqual(m.blockers, ["send email — Error: no"]);
  assert.deepEqual(m.waiting, ["Your approval in OPERATIONS"]);
  assert.equal(m.now, "Writing"); assert.equal(m.done.length, 1);
});

test("cancelsJob: only an explicit cancel stops the job", () => {
  for (const t of ["stop", "Cancel that", "okay, never mind", "Orbit forget it", "abort"]) assert.ok(cancelsJob(t), t);
  for (const t of ["what about tomorrow", "don't stop", "and add a footer", "bus stop times"]) assert.ok(!cancelsJob(t), t);
});
