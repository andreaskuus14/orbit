import { test } from "node:test";
import assert from "node:assert/strict";
import { around, fileActions, fileDate, filterFiles, groupOf, highlight, isJournalName, jobCard, plainError, searchesInside, size, statusLine, storageMap, vaultChanges } from "../src/lib/vault-ui-pure.ts";
import { isJournalName as coreJournal } from "../src/lib/offline-tools-pure.ts";
import { doneShare } from "../src/lib/progress-pure.ts";
import type { TmRecord } from "../src/lib/time-machine-pure.ts";

const f = (name: string, size: number, mtime: number, type: "pdf" | "image" | "text" | "video" | "audio" | "doc" | "other") => ({ name, size, mtime, type });
const FILES = [f("b.pdf", 300, 3, "pdf"), f("a.png", 900, 1, "image"), f("c.txt", 100, 2, "text"), f("d.mp4", 600, 4, "video"), f("e.zip", 100, 5, "other")];

test("groups and the storage map add up", () => {
  assert.equal(groupOf("doc"), "docs"); assert.equal(groupOf("audio"), "media"); assert.equal(groupOf("other"), "other");
  const m = storageMap(FILES);
  assert.deepEqual(m.map((g) => g.group), ["docs", "images", "media", "other"]);
  assert.deepEqual(m.map((g) => g.count), [2, 1, 1, 1]);
  assert.equal(m[0].bytes, 400);
  assert.ok(Math.abs(m.reduce((a, g) => a + g.share, 0) - 1) < 1e-9);
  assert.ok(storageMap([]).every((g) => g.share === 0 && g.count === 0));
});

test("one search: name or a word inside, then group, then sort", () => {
  assert.deepEqual(filterFiles(FILES, { q: "", group: "all", sort: "newest", hits: null }).map((x) => x.name), ["e.zip", "d.mp4", "b.pdf", "c.txt", "a.png"]);
  assert.deepEqual(filterFiles(FILES, { q: "", group: "all", sort: "size", hits: null }).map((x) => x.name), ["a.png", "d.mp4", "b.pdf", "c.txt", "e.zip"]);
  assert.deepEqual(filterFiles(FILES, { q: "lunch", group: "all", sort: "name", hits: { "c.txt": "…lunch…" } }).map((x) => x.name), ["c.txt"]);
  assert.deepEqual(filterFiles(FILES, { q: "PDF", group: "all", sort: "name", hits: null }).map((x) => x.name), ["b.pdf"]);
  assert.deepEqual(filterFiles(FILES, { q: "", group: "docs", sort: "name", hits: null }).map((x) => x.name), ["b.pdf", "c.txt"]);
  assert.deepEqual(filterFiles([f("file10", 1, 1, "text"), f("file2", 1, 1, "text")], { q: "", group: "all", sort: "name", hits: null }).map((x) => x.name), ["file2", "file10"]);
  assert.equal(searchesInside("a"), false); assert.equal(searchesInside(" ab "), true);
});

test("highlight marks every match, case-insensitive; around shows the match", () => {
  assert.deepEqual(highlight("Lunch and lunch", "lunch"), [{ text: "Lunch", hit: true }, { text: " and ", hit: false }, { text: "lunch", hit: true }]);
  assert.deepEqual(highlight("abc", ""), [{ text: "abc", hit: false }]);
  assert.deepEqual(highlight("", "x"), []);
  const long = "Meet at the bus station at 8:15 in the morning by the old town hall. Bring a packed lunch and a rain jacket.";
  const a = around(long, "lunch");
  assert.ok(a.startsWith("…") && a.includes("lunch") && a.indexOf("lunch") < 40, a);
  assert.equal(around("short lunch", "lunch"), "short lunch");
});

test("dates are short, local and in Tallinn time", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  assert.equal(fileDate(Date.parse("2026-11-23T06:25:00Z"), "en", now), "Today 08:25");
  assert.equal(fileDate(Date.parse("2026-11-22T16:07:00Z"), "et", now), "Eile 18:07");
  assert.equal(fileDate(Date.parse("2026-11-12T10:00:00Z"), "en", now), "12 Nov");
  assert.match(fileDate(Date.parse("2025-03-02T10:00:00Z"), "en", now), /^2 Mar 2025$/);
  assert.match(fileDate(Date.parse("2026-11-12T10:00:00Z"), "et", now), /^12\. nov$/);
});

test("sizes are 1024-based with the locale's decimal sign; status line", () => {
  assert.equal(size(90, "en"), "90 B"); assert.equal(size(1536, "en"), "1.5 KB"); assert.equal(size(1536, "et"), "1,5 KB");
  assert.equal(size(5 * 1024 ** 3, "en"), "5 GB"); assert.equal(size(40 * 1024 ** 2, "en"), "40 MB");
  assert.equal(statusLine({ count: 0, bytes: 0, limit: 5 * 1024 ** 3, noCloud: 0, cloudError: false }, "en"), "No files yet");
  const s = statusLine({ count: 11, bytes: 3.5 * 1024 ** 2, limit: 5 * 1024 ** 3, noCloud: 0, cloudError: false }, "en");
  assert.equal(s, "11 files · 3.5 MB of 5 GB"); assert.ok(s.length <= 40);
  assert.equal(statusLine({ count: 1, bytes: 1, limit: 1, noCloud: 2, cloudError: false }, "en"), "1 file · 2 without a cloud copy");
  assert.equal(statusLine({ count: 3, bytes: 1, limit: 1, noCloud: 2, cloudError: true }, "et"), "3 faili · pilv pole kättesaadav");
});

test("file actions: journal-looking files never go to a model", () => {
  assert.equal(isJournalName("my-journal.txt"), true);
  for (const n of ["journal.md", "Päevik 2026.txt", "paevik.pdf", "diary.docx", "life.json", "school.pdf", "notes.txt"]) assert.equal(isJournalName(n), coreJournal(n), n);
  const j = fileActions({ name: "diary.pdf", type: "pdf", size: 10 }, 4e6);
  assert.equal(j.ask, false); assert.equal(j.skill, false); assert.equal(j.memory, false); assert.equal(j.podcast, false);
  const p = fileActions({ name: "invoice.pdf", type: "pdf", size: 10 }, 4e6);
  assert.equal(p.preview, "doctext"); assert.equal(p.ask, true); assert.equal(p.fields, true); assert.equal(p.memory, true);
  assert.equal(fileActions({ name: "big.pdf", type: "pdf", size: 5e6 }, 4e6).memory, false);
  assert.equal(fileActions({ name: "a.zip", type: "other", size: 1 }, 4e6).preview, "none");
  assert.equal(fileActions({ name: "a.png", type: "image", size: 1 }, 4e6).ask, false);
  assert.equal(fileActions({ name: "a.md", type: "text", size: 1 }, 4e6).compare, true);
});

test("jobs become Progress cards with a real share", () => {
  const p = jobCard({ id: "up:1", title: "Adding 4 files", done: 1, total: 4, now: "a.pdf", at: 0 });
  assert.equal(p.phase, "working"); assert.equal(doneShare(p), 0.25); assert.equal(p.now, "a.pdf"); assert.equal(p.steps[1].state, "now");
  assert.equal(jobCard({ id: "x", title: "t", at: 0 }).steps.length, 0);
  assert.equal(jobCard({ id: "x", title: "t", at: 0, failed: "no" }).phase, "failed");
});

test("vault changes from the time machine: newest first, undone marked, journal never shown", () => {
  const now = Date.parse("2026-11-23T10:00:00Z");
  const recs: TmRecord[] = [
    { id: "tm1", at: "2026-11-23T08:00:00Z", title: 'VAULT: made "chart.png"', why: "Made in the code sandbox", changes: [{ t: "vault", before: null, after: { name: "chart.png" } }] },
    { id: "tm2", at: "2026-11-23T09:00:00Z", title: 'VAULT: made "journal-copy.txt"', changes: [{ t: "vault", before: null, after: { name: "journal-copy.txt" } }] },
    { id: "tm3", at: "2026-11-23T09:30:00Z", title: 'Undone: VAULT: made "old.png"', changes: [{ t: "vault", before: { name: "old.png" }, after: { trash: "x", name: "old.png" } }], undid: "tm4" },
    { id: "tm4", at: "2026-11-22T09:30:00Z", title: 'VAULT: made "old.png"', changes: [{ t: "vault", before: null, after: { name: "old.png" } }] },
    { id: "tm5", at: "2026-11-01T09:30:00Z", title: 'VAULT: made "ancient.png"', changes: [{ t: "vault", before: null, after: { name: "ancient.png" } }] },
    { id: "tm6", at: "2026-11-23T09:40:00Z", title: "Memory changed: x", changes: [{ t: "memory", id: "m", before: null, after: null }] },
  ];
  const c = vaultChanges(recs, now);
  assert.deepEqual(c.map((x) => x.id), ["tm3", "tm1", "tm4"]);
  assert.equal(c[0].redo, true); assert.equal(c[0].open, true); assert.equal(c[0].made, false); assert.equal(c[1].made, true);
  assert.equal(c[2].open, false);
  assert.equal(c[1].title, 'made "chart.png"'); assert.equal(c[1].why, "Made in the code sandbox"); assert.equal(c[1].name, "chart.png");
});

test("errors in plain words", () => {
  const w = { localOff: "LOCAL" };
  assert.equal(plainError("The local model is off: run tools\\ollama\\setup.ps1", "F", w), "LOCAL");
  assert.equal(plainError("", "F", w), "F");
  assert.equal(plainError("Cloud unavailable: fetch failed", "F", { ...w, cloudDown: "CLOUD" }), "CLOUD");
  assert.equal(plainError("Set ORBIT_OCR=1 first", "F", w), "F");
  assert.equal(plainError("Files can be at most 40 MB", "F", w), "Files can be at most 40 MB");
});
