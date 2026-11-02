import { test } from "node:test";
import assert from "node:assert/strict";
import { currentOnly, isCurrent, scopeOfRecord, scopeTags, temporaryOf, typeLabel } from "../src/lib/memory-types-pure.ts";

const at = "2026-11-01T12:00:00Z", now = Date.parse(at);
const record = (content: string, tags: string[] = []) => ({ id: "m", kind: "note", source: "capture", created_at: at, content, tags });

test("project-only wording without a project never becomes global truth", () => {
  for (const text of ["In this project use tabs", "For this project use British spelling", "Selles projektis kasuta tabe"]) {
    assert.equal(temporaryOf(text, at)?.kind, "project");
    const r = record(text);
    for (const project of [undefined, "ORBIT", "Other"]) {
      assert.equal(isCurrent(r, { now, project }), false, text);
      assert.deepEqual(currentOnly([r], { now, project }), []);
    }
    assert.doesNotMatch(typeLabel(r), /undefined/);
  }
});

test("capture retains unresolved project scope even when the cue was in the title", () => {
  const tags = scopeTags("For this project use tabs\nIndent with tabs", ["style"], {});
  assert.deepEqual(tags, ["style", "scope:"]);
  // Retrieval sees content, not the title/capture string that originally supplied the scope cue.
  const r = record("Indent with tabs", tags);
  assert.equal(scopeOfRecord(r).kind, "project");
  for (const project of [undefined, "ORBIT", "unknown", ""]) assert.equal(isCurrent(r, { now, project }), false);
});

test("an explicit empty project scope is closed, while named projects and global facts still work", () => {
  const unresolved = record("Use tabs", ["scope:"]);
  assert.equal(scopeOfRecord(unresolved).kind, "project");
  assert.equal(isCurrent(unresolved, { now }), false);
  assert.equal(isCurrent(unresolved, { now, project: "ORBIT" }), false);
  const text = "For this project use tabs";
  const named = record("Use tabs", scopeTags(text, [], { project: "ORBIT" }));
  assert.deepEqual(named.tags, ["scope:ORBIT"]);
  assert.equal(isCurrent(named, { now, project: "orbit" }), true);
  assert.equal(isCurrent(named, { now, project: "Other" }), false);
  assert.equal(isCurrent(named, { now }), false);
  assert.equal(isCurrent(record("The capital of Estonia is Tallinn"), { now }), true);
});
