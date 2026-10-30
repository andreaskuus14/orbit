import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPack, outdatedSince, packMarkdown, packable, type PackRec } from "../src/lib/memory-pack-pure.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const r = (o: Partial<PackRec>): PackRec => ({ id: "x", title: "T", content: "", kind: "note", tags: ["scope:orbit"], source: "capture", created_at: "2026-10-01T10:00:00Z", ...o });
const rows = [
  r({ id: "goal", kind: "goal", title: "Ship ORBIT v1", content: "by December" }),
  r({ id: "dec", tags: ["scope:orbit", "decision", "vault:v-123"], title: "Use Supabase", content: "for storage" }),
  r({ id: "con", title: "Never post", content: "must stay read-only" }),
  r({ id: "q", title: "Budget", content: "How much per month?" }),
  r({ id: "folder", folder: "orbit", tags: ["decision"], title: "Dark theme", content: "default" }),
];

test("guard: other projects, chat-scoped, superseded, replaced, expired and journal/LIFE never enter the pack", () => {
  const bad = [
    r({ id: "other", tags: ["scope:school", "decision"], title: "Other project" }),
    r({ id: "chat", tags: ["scope:orbit", "chat:abc", "decision"], title: "Chat only" }),
    r({ id: "sup", tags: ["scope:orbit", "superseded", "decision"], title: "Old" }),
    r({ id: "rev", tags: ["scope:orbit", "revoked", "constraint"], title: "Revoked rule" }),
    r({ id: "old", tags: ["scope:orbit", "constraint"], title: "Old rule", content: "x" }),
    r({ id: "fix", tags: ["scope:orbit", "corrects:old", "constraint"], title: "New rule", content: "y" }),
    r({ id: "exp", tags: ["scope:orbit", "until:2026-10-01"], title: "Never deploy on Friday" }),
    r({ id: "jr", kind: "journal", tags: ["scope:orbit", "decision"], title: "Diary" }),
    r({ id: "life", tags: ["scope:orbit", "life", "decision"], title: "Habit" }),
    r({ id: "glob", tags: ["decision"], title: "Global" }),
  ];
  const ids = packable([...rows, ...bad], "orbit", NOW).map((x) => x.id).sort();
  assert.deepEqual(ids, ["con", "dec", "fix", "folder", "goal", "q"]);
  const md = packMarkdown(buildPack([...rows, ...bad], "orbit", NOW));
  for (const s of ["Other project", "Chat only", "Old", "Revoked", "Diary", "Habit", "Global", "Friday"]) assert.ok(!md.includes(s), s);
});

test("sections, VAULT files by stable id, markdown", () => {
  const p = buildPack(rows, "ORBIT", NOW);
  assert.deepEqual(p.objective.map((l) => l.id), ["goal"]);
  assert.deepEqual(p.decisions.map((l) => l.id).sort(), ["dec", "folder"]);
  assert.deepEqual(p.constraints.map((l) => l.id), ["con"]);
  assert.deepEqual(p.questions.map((l) => l.id), ["q"]);
  assert.deepEqual(p.files, [{ vault: "v-123", from: "dec" }]);
  assert.equal(p.rev, 1);
  assert.match(packMarkdown(p), /## Decisions[\s\S]*Use Supabase: for storage \[memory:dec\][\s\S]*vault:v-123/);
});

test("revisions and the outdated flag", () => {
  const p = buildPack(rows, "orbit", NOW);
  assert.equal(buildPack(rows, "orbit", NOW + 1, p).rev, 1); // same content, same revision
  assert.equal(outdatedSince(p, rows, NOW), null);
  const edited = rows.map((x) => (x.id === "dec" ? { ...x, content: "for auth", updated_at: "2026-10-30T13:00:00Z" } : x));
  assert.equal(outdatedSince(p, edited, NOW), "2026-10-30T13:00:00Z");
  assert.equal(buildPack(edited, "orbit", NOW, p).rev, 2);
  assert.equal(outdatedSince(p, rows.filter((x) => x.id !== "q"), NOW), p.builtAt); // removed source
  const added = [...rows, r({ id: "n", tags: ["scope:orbit", "decision"], title: "New", created_at: "2026-10-31T00:00:00Z" })];
  assert.equal(outdatedSince(p, added, NOW), "2026-10-31T00:00:00Z");
});
