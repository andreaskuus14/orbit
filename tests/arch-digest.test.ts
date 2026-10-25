import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, digestDue, digestLine, digestPrompt, digestStats, parseDigest } from "../src/lib/arch-digest-pure.ts";
import { critiqueNote, scanNote } from "../src/lib/arch-studio-pure.ts";

const crit = (file: string) => {
  const n = critiqueNote({ summary: "S.", proportion: "Good ratio.", circulation: "The stair blocks the entry.", light: "North-only glazing.", structure: "Clear grid.", precedent: { name: "Villa Savoye", why: "ramp" }, next: [] }, { file });
  return { id: file, ...n, created_at: "2026-10-20T10:00:00Z" };
};
const rows = [
  crit("a.jpg"), crit("b.jpg"), crit("c.jpg"),
  { id: "l1", title: "Precedent: Villa Savoye", content: "…", tags: ["arch", "lesson"], created_at: "2026-10-21T10:00:00Z" },
  { id: "s1", ...scanNote({ file: "room.ply", vault: "room.splat", format: "ply", total: 10, count: 10, size: [3, 2.5, 4] }), created_at: "2026-10-22T10:00:00Z" },
];

test("digest: due Sunday from 17:00 or Monday, once per week", () => {
  const sun = new Date(2026, 9, 25, 17, 30), mon = new Date(2026, 9, 26, 9);
  assert.equal(digestDue(sun, undefined), "2026-10-19");
  assert.equal(digestDue(mon, undefined), "2026-10-19"); // catch-up for the same week
  assert.equal(digestDue(mon, "2026-10-19"), null);
  assert.equal(digestDue(new Date(2026, 9, 25, 16), undefined), null);
  assert.equal(digestDue(new Date(2026, 9, 22, 18), undefined), null);
});

test("digest: counts come from the notes, weaknesses from the model's per-critique flags", () => {
  const s = digestStats(rows);
  assert.deepEqual([s.lessons, s.critiques, s.scans, s.precedents], [1, 3, 1, ["Villa Savoye"]]);
  assert.equal(s.list[0].sections.circulation, "The stair blocks the entry.");
  assert.match(digestPrompt(s.list), /<critique 2>[\s\S]*circulation: The stair/);
  const ai = parseDigest('ok {"flagged":[["circulation","light"],["Circulation","circulation"],["circulation","made-up"]],"focus":"Plan the entry sequence first."}', 3)!;
  assert.deepEqual(ai.weak, [{ aspect: "circulation", count: 3 }, { aspect: "light", count: 1 }]);
  const d = buildDigest("2026-10-19", s, ai, new Date(2026, 9, 25, 17));
  assert.equal(d.line, "ARCH: 1 lesson (Villa Savoye), 3 critiques (circulation flagged 3×, light flagged 1×), 1 scan. Focus: Plan the entry sequence first.");
  assert.equal(parseDigest("nope", 3), null);
});

test("digest: no model reply still gives a focus; the weekly line only while fresh", () => {
  const empty = buildDigest("2026-10-19", digestStats([]), null, new Date(2026, 9, 25, 17));
  assert.match(empty.line, /^ARCH: 0 lessons, no critiques, 0 scans\. Focus: Photograph one sketch/);
  assert.equal(digestLine(empty, new Date(2026, 9, 26)), empty.line);
  assert.equal(digestLine(empty, new Date(2026, 10, 5)), null);
  assert.equal(digestLine(undefined, new Date()), null);
});
