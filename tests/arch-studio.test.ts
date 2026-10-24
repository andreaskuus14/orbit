import { test } from "node:test";
import assert from "node:assert/strict";
import { critiqueNote, critiquePrompt, lessonTag, parseCritique, scanNote, scanVaultName, searchStudio, slug, studioItems, studioLinks, type StudioMemory } from "../src/lib/arch-studio-pure.ts";

test("slug and lessonTag stay within the 40-char tag limit", () => {
  assert.equal(slug("Villa Savoye"), "villa-savoye");
  assert.equal(slug("Säynätsalo Town Hall"), "saynatsalo-town-hall");
  assert.equal(lessonTag("  "), "");
  assert.ok(`precedent:${slug("x".repeat(100))}`.length <= 40);
});

test("scanNote round-trips the vault name and tags the open lesson", () => {
  const n = scanNote({ file: "kitchen.ply", vault: "kitchen (2).splat", format: "ply", total: 900_000, count: 300_000, size: [4, 2.5, 3] }, "lesson:kumu");
  assert.equal(n.title, "Scan: kitchen");
  assert.equal(scanVaultName(n.content), "kitchen (2).splat");
  assert.deepEqual(n.tags, ["arch", "scan", "lesson:kumu"]);
  assert.match(n.content, /downsampled/);
  assert.equal(scanVaultName("no line"), null);
});

const good = JSON.stringify({ summary: "Clear plan.", proportion: "p", circulation: "c", light: "l", structure: "s", precedent: { name: "Villa Savoye", why: "ramp" }, next: ["a", "", "b"] });

test("parseCritique: JSON inside prose, needs 3 of 4 aspects", () => {
  const c = parseCritique(`Here:\n${good}\nthanks`)!;
  assert.equal(c.precedent.name, "Villa Savoye");
  assert.deepEqual(c.next, ["a", "b"]);
  assert.equal(parseCritique("no json"), null);
  assert.equal(parseCritique("{bad"), null);
  assert.equal(parseCritique(JSON.stringify({ proportion: "p", light: "l" })), null);
});

test("critiqueNote tags lesson and precedent; prompt carries brief, lesson and notes as data", () => {
  const n = critiqueNote(parseCritique(good)!, { file: "sketch.jpg", brief: "studio house", lesson: "lesson:kumu" });
  assert.deepEqual(n.tags, ["arch", "sketch", "critique", "lesson:kumu", "precedent:villa-savoye"]);
  assert.equal(n.title, "Sketch critique: sketch");
  assert.match(n.content, /## Precedent\nVilla Savoye: ramp/);
  const p = critiquePrompt({ brief: "studio house", lesson: { building: "Kumu", text: "ramps" }, notes: [{ title: "Precedent: Kumu", content: "a\nb" }] });
  assert.match(p, /brief \(data\):\nstudio house/);
  assert.match(p, /Lesson open right now \(data\): Kumu/);
  assert.match(p, /- Precedent: Kumu: a b/);
  assert.equal(critiquePrompt({}), "Critique the attached sketch.");
});

const rows: StudioMemory[] = [
  { id: "L", title: "Precedent: Villa Savoye", content: "pilotis", tags: ["arch", "lesson"], created_at: "2026-10-01" },
  { id: "C", title: "Sketch critique: s1", content: "ramp", tags: ["arch", "sketch", "critique", "precedent:villa-savoye"], created_at: "2026-10-02", storage_path: "u/x.jpg" },
  { id: "S", title: "Scan: room", content: "vault: room.splat", tags: ["arch", "scan", "lesson:villa-savoye"], created_at: "2026-10-03" },
  { id: "N", title: "Kumu", content: "other", tags: ["arch"], created_at: "2026-10-04" },
];

test("studioItems + studioLinks: old lessons link by title, critiques by precedent, scans by lesson tag", () => {
  const items = studioItems(rows);
  assert.deepEqual(items.map((i) => i.kind), ["lesson", "critique", "scan", "note"]);
  assert.equal(items[2].vault, "room.splat");
  assert.equal(items[1].image, true);
  const pairs = studioLinks(items).map((l) => [l.a, l.b].sort().join("-")).sort();
  assert.deepEqual(pairs, ["C-L", "C-S", "L-S"]);
});

test("searchStudio: every word, accent-insensitive, over title/tags/content", () => {
  const items = studioItems(rows);
  assert.deepEqual(searchStudio(items, "savoye").map((i) => i.id), ["L", "C", "S"]);
  assert.deepEqual(searchStudio(items, "SAVOYE ramp").map((i) => i.id), ["C"]);
  assert.equal(searchStudio(items, "  ").length, 4);
  assert.deepEqual(searchStudio(studioItems([{ ...rows[3], title: "Säynätsalo" }]), "saynatsalo").length, 1);
});
