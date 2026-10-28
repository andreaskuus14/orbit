import { test } from "node:test";
import assert from "node:assert/strict";
import { projectRecord, projectRecordPrompt } from "../src/lib/project-record-pure.ts";
import { addLines, checkpointInput, checkpointPrompt, type Checkpoint } from "../src/lib/checkpoint-pure.ts";
import { applyGuard, archRev, fileRev, staleBasis } from "../src/lib/artifact-rev-pure.ts";
import type { ChatStore } from "../src/lib/core-chats-pure.ts";

const store: ChatStore = { projects: [{ id: "p1", name: "Cabin", instructions: "", pins: [], createdAt: "2026-10-01" }], chats: { a: "p1", b: "p1", new: "p1", x: "p2" } };
const line = (id: string, kind: string, text: string, at: string, extra = {}) => ({ id, kind, text, at, by: "owner", ...extra });
const cps = {
  a: { lines: [line("1", "constraint", "budget under 300 €", "2026-10-01T00:00:00Z", { topic: "budget" }), line("2", "next", "draw the plan", "2026-10-01T00:00:00Z"), line("3", "artifact", "file plan.md", "2026-10-01T00:00:00Z", { ref: "file:plan.md", v: 1 })] },
  b: { lines: [line("4", "constraint", "budget under 500 €", "2026-10-05T00:00:00Z", { topic: "budget" }), line("5", "next", "render the facade", "2026-10-05T00:00:00Z"), line("6", "artifact", "file plan.md", "2026-10-05T00:00:00Z", { ref: "file:plan.md", v: 2, rev: "sha256:ab@1" }), line("7", "blocker", "waiting for site survey", "2026-10-05T00:00:00Z")] },
  x: { lines: [line("8", "decision", "other project secret", "2026-10-09T00:00:00Z")] },
};

test("a new chat in the project gets the merged current record, newest per slot, other projects excluded", () => {
  const r = projectRecord(store, "new", cps)!;
  assert.equal(r.chats, 2);
  const texts = r.lines.map((l) => l.text);
  assert.deepEqual(texts.sort(), ["budget under 500 €", "file plan.md", "render the facade", "waiting for site survey"]);
  assert.equal(r.lines.find((l) => l.kind === "artifact")!.v, 2);
  const p = projectRecordPrompt(r);
  assert.match(p, /PROJECT RECORD "Cabin"/);
  assert.match(p, /→ file:plan\.md v2 rev sha256:ab@1 \[chat b/);
  assert.match(p, /Blockers:\n- waiting for site survey/);
  assert.doesNotMatch(p, /secret|draw the plan|300/);
});

test("excludes the asking chat's own lines; empty outside a project", () => {
  assert.ok(!projectRecord(store, "b", cps)!.lines.some((l) => l.chat === "b"));
  assert.equal(projectRecord(store, "loose", cps), null);
  assert.equal(projectRecordPrompt(null), "");
});

test("save_checkpoint takes success criteria, blockers and artifact revs", () => {
  const d = checkpointInput({ success: ["passes crit"], blockers: "no survey", artifacts: [{ id: "arch:v9", rev: "arch:v9" }] });
  assert.ok(Array.isArray(d));
  const cp: Checkpoint = { lines: [] };
  addLines(cp, d as never, "core", "2026-10-28T00:00:00Z", () => String(Math.random()));
  addLines(cp, [{ kind: "artifact", ref: "arch:v9", text: "arch:v9", rev: "arch:v10" }], "orbit", "2026-10-28T01:00:00Z", () => "z");
  assert.equal(cp.lines.find((l) => l.kind === "artifact")!.rev, "arch:v10");
  assert.match(checkpointPrompt(cp), /Success criteria:\n- passes crit/);
  assert.match(checkpointPrompt(cp), /Blockers:\n- no survey/);
});

test("apply guard: same bytes pass, changed or missing artifacts are explained", () => {
  const basis = [{ ref: "file:a.md", rev: fileRev("abc", 1) }, { ref: "arch:house", rev: archRev("v3") }];
  assert.deepEqual(applyGuard(basis, { "file:a.md": fileRev("abc", 999), "arch:house": archRev("v3") }), { ok: true });
  const g = applyGuard(basis, { "file:a.md": fileRev("def", 2) });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.deepEqual(g.refresh, ["file:a.md", "arch:house"]);
    assert.match(g.explain, /changed after planning.*gone or unreadable/);
  }
  assert.equal(staleBasis([], {}).length, 0);
});
