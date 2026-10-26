import { test } from "node:test";
import assert from "node:assert/strict";
import { canCommit, compactContext, correctionPlan, exactMatchIds, exactTerms, forgetPlan, initialConfirmation, parseControl, projectBriefing, rememberRecord, whySources, type MemRecord, type Outcome } from "../src/lib/provenance-pure.ts";

const rec = (id: string, o: Partial<MemRecord> = {}): MemRecord => ({ id, kind: "note", title: id, content: `about ${id}`, source: "capture", created_at: "2026-10-01T00:00:00Z", ...o });
const NOW = Date.parse("2026-10-26T00:00:00Z");

test("suggestions never become commitments automatically", () => {
  assert.equal(initialConfirmation("core"), "suggested");
  assert.equal(initialConfirmation("capture"), "confirmed");
  assert.equal(canCommit({ confirmation: "suggested" }, true), false);
  assert.equal(canCommit({ confirmation: "confirmed" }, false), false);
  assert.equal(canCommit({ confirmation: "confirmed" }, true), true);
});

test("exact terms: ids, quotes and mid-sentence names", () => {
  const id = "0f8a1b2c-1234-4abc-8def-001122334455";
  const t = exactTerms(`What did we decide about "pet sim" with Marko and ${id}?`);
  assert.ok(t.includes("pet sim") && t.includes("marko") && t.includes(id));
  assert.ok(!t.includes("what"));
  const rows = [rec(id), rec("b", { title: "Call with Marko" }), rec("c", { title: "Markovich" }), rec("j", { kind: "journal", title: "Marko" })];
  assert.deepEqual(exactMatchIds(t, rows), [id, "b"]);
});

test("compact context: exact first, suggested/stale after, journal dropped, links", () => {
  const rows = [rec("a"), rec("s", { confirmation: "suggested" }), rec("old", { recheck_at: "2026-10-01T00:00:00Z" }), rec("x"), rec("j", { kind: "journal" })];
  const out = compactContext(["x"], ["s", "old", "a", "j"], rows, NOW, 3);
  assert.deepEqual(out.map((o) => o.id), ["x", "a", "s"]);
  assert.match(out[0].link, /id=x/);
  assert.equal(compactContext([], ["old"], rows, NOW)[0].stale, true);
});

test("project briefing uses confirmed outcomes only and closes made decisions", () => {
  const o = (id: string, kind: Outcome["kind"], text: string, at: string, extra: Partial<Outcome> = {}): Outcome => ({ id, kind, text, at, source: "ledger", ...extra });
  const b = projectBriefing("ORBIT", [
    o("1", "goal", "Ship voice", "2026-10-01"), o("2", "goal", "Ship memory", "2026-10-20"),
    o("3", "decision_open", "Use pgvector?", "2026-10-02"), o("4", "decision_made", "use pgvector?", "2026-10-05"),
    o("5", "decision_open", "Pick a font", "2026-10-03"), o("6", "next", "Guess: rewrite all", "2026-10-21", { confirmation: "suggested" }),
    o("7", "file", "src/lib/memory.ts", "2026-10-04"), o("8", "done", "Hygiene shipped", "2026-10-06"),
  ]);
  assert.equal(b.objective, "Ship memory");
  assert.deepEqual(b.openDecisions, ["Pick a font"]);
  assert.deepEqual(b.nextSteps, []);
  assert.ok(b.done.includes("Hygiene shipped") && b.done.includes("Decided: use pgvector?"));
  assert.deepEqual(b.files, ["src/lib/memory.ts"]);
  assert.ok(!b.sources.includes("6"));
});

test("controls parse", () => {
  assert.equal(parseControl("Why do you think that?")?.action, "why");
  assert.deepEqual(parseControl("Remember this: I train on Tuesdays"), { action: "remember", text: "I train on Tuesdays" });
  assert.equal(parseControl("Correct this: it's Wednesdays")?.action, "correct");
  assert.equal(parseControl("forget that")?.action, "forget");
  assert.equal(parseControl("hello"), null);
});

test("why follows source_ref chain, skips journal", () => {
  const rows = [rec("fact", { source: "core", source_ref: "msg", created_at: "2026-10-03" }), rec("msg", { source: "capture", source_ref: "j" }), rec("j", { kind: "journal" })];
  assert.deepEqual(whySources(["fact"], rows).map((s) => s.id), ["fact", "msg"]);
});

test("remember / correct / forget plans", () => {
  const r = rememberRecord("  I train  on Tuesdays ", "m1", NOW, 30)!;
  assert.equal(r.confirmation, "confirmed");
  assert.equal(r.content, "I train on Tuesdays");
  assert.equal(r.recheck_at, "2026-11-25T00:00:00.000Z");
  assert.equal(rememberRecord("  ", null, NOW), null);
  const rows = [rec("a"), rec("sum", { tags: ["a", "b"] }), rec("ep", { source_ref: "a" }), rec("z")];
  const c = correctionPlan("a", " new ", rows);
  assert.deepEqual([c.patch.content, c.patch.embedding, c.reindex, c.rebuild], ["new", null, ["a"], ["sum", "ep"]]);
  assert.deepEqual(forgetPlan("a", rows).rebuild, ["sum", "ep"]);
});

import { citedIds, isMissingColumn, rewriteDerived } from "../src/lib/provenance-pure.ts";
test("io helpers", () => {
  assert.equal(isMissingColumn({ code: "42703" }), true);
  assert.equal(isMissingColumn({ message: "Could not find the 'confirmation' column of 'memories'" }), true);
  assert.equal(isMissingColumn({ code: "23505" }), false);
  assert.equal(rewriteDerived("A. I train Tuesdays.\n\n\nB.", "I train Tuesdays.", "I train Wednesdays."), "A. I train Wednesdays.\n\nB.");
  assert.equal(rewriteDerived("A. B.", "short", ""), null);
  assert.equal(rewriteDerived("nothing here", "I train Tuesdays.", ""), null);
  assert.deepEqual(citedIds("x [m:0f8a1b2c-1234-4abc-8def-001122334455] y [m:0f8a1b2c-1234-4abc-8def-001122334455]"), ["0f8a1b2c-1234-4abc-8def-001122334455"]);
});

import { controlHint } from "../src/lib/provenance-pure.ts";
test("CORE control hint", () => {
  const id = "0f8a1b2c-1234-4abc-8def-001122334455";
  assert.equal(controlHint("hello", []), "");
  assert.match(controlHint("Why do you think that?", [{ role: "assistant", content: `You like X [m:${id}]` }]), new RegExp(id));
  assert.match(controlHint("why do you think that?", []), /cited no memories/);
  assert.match(controlHint("Forget that", []), /cannot delete/);
});
