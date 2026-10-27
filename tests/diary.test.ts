import { test } from "node:test";
import assert from "node:assert/strict";
import { asksDiary, cleanEntry, diaryBlock, pageEntries, parseStore, pickFacts, putEntry, templateEntry, type Entry, type FactsIn } from "../src/lib/diary-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";
import type { Prediction } from "../src/lib/predict-pure.ts";

const NOW = Date.parse("2026-10-26T06:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ev = (type: string, data: object, h = 2) => ({ id: type + h, at: ago(h), type, planet: "core", data }) as LedgerEvent;
const base = (): FactsIn => ({ now: NOW, events: [], lessons: [], preds: [], issues: [], episodes: [], day: "2026-10-26" });

test("facts come from ORBIT's records only: LIFE ledger types and call episodes are ignored", () => {
  const x = base();
  x.events = [ev("core.turn", { model: "s", tools: 0, ms: 1 }), ev("life.habit", { habit: "run", done: true }), ev("journal.saved", { memoryId: "m" }), ev("focus.session", { minutes: 30 })];
  x.episodes = [{ type: "call", when: "2026-10-26", title: "Call: he talked about his exam stress" }, { type: "win", when: "2026-10-26", title: "Win: Egg hatch Short hit 10k" }];
  const f = pickFacts(x), all = JSON.stringify(f);
  assert.ok(f.did.includes("answered 1 CORE message"));
  assert.ok(all.includes("Egg hatch"));
  assert.ok(!/habit|journal|focus|exam stress/i.test(all));
});

test("old records are outside the day; failures become wrong + next", () => {
  const x = base();
  x.events = [ev("core.turn", { model: "s", tools: 0, ms: 1 }, 30)];
  x.run = { id: "r", key: "2026-10-26", startedAt: ago(5), calls: 4, ms: 1, deferred: 2, items: [
    { kind: "research", ref: "a", label: "🌙 Tonight: compare pet sim egg prices", status: "done", at: ago(4) },
    { kind: "health", ref: "h", label: "ORBIT health check", status: "failed", why: "timeout", at: ago(3) }] };
  x.issues = [{ title: "Studio bridge drops", status: "new", last: ago(3) }, { title: "Old fixed thing", status: "resolved", last: ago(50) }];
  const f = pickFacts(x);
  assert.ok(!f.did.some((d) => d.includes("CORE")));
  assert.ok(f.did.includes("worked on compare pet sim egg prices"));
  assert.ok(f.wrong.includes("ORBIT health check failed (timeout)"));
  assert.ok(f.wrong.some((w) => w.includes("Studio bridge drops")));
  assert.ok(f.next.includes("retry ORBIT health check") && f.next.some((n) => n.includes("2 tasks")));
  assert.ok(!JSON.stringify(f).includes("Old fixed thing"));
});

test("predictions and lessons: hits counted, the worst area named", () => {
  const x = base();
  const p = (id: string, prob: number, outcome: boolean, area: Prediction["area"] = "clips"): Prediction => ({ id, area, at: ago(30), p: prob, why: "", f: [], outcome, decidedAt: ago(1) });
  x.preds = [p("1", 0.8, true), p("2", 0.8, false), p("3", 0.9, false), p("4", 0.3, false, "deals")];
  x.lessons = [{ text: "He keeps Shorts under 30 s", status: "proposed", at: ago(2) }, { text: "Old", status: "proposed", at: ago(100) }];
  const f = pickFacts(x);
  assert.ok(f.learned.includes("guessed 2 of 4 of his approvals right"));
  assert.ok(f.learned.includes("I noticed: He keeps Shorts under 30 s") && !f.learned.some((l) => l.includes("Old")));
  assert.ok(f.wrong.includes("misjudged 2 decisions on clips"));
});

test("template: 3-6 sentences, wrong/tomorrow only with evidence", () => {
  const quiet = templateEntry({ did: [], learned: [], wrong: [], next: [] });
  assert.equal(quiet.split(/(?<=\.)\s/).length, 3);
  assert.ok(!quiet.includes("got wrong") && !quiet.includes("tomorrow"));
  const busy = templateEntry({ did: ["night shift: 2 done", "answered 3 CORE messages"], learned: ["x"], wrong: ["y failed"], next: ["retry y"] });
  assert.match(busy, /^Today I ran the night shift: 2 done and answered 3 CORE messages\./);
  assert.match(busy, /What I got wrong today: y failed\. What I'll try tomorrow: retry y\.$/);
});

test("cleanEntry strips markdown, caps at 6 sentences, rejects junk", () => {
  assert.equal(cleanEntry("## Diary\n- **Today** I fixed a bug. I learned a thing."), "Diary Today I fixed a bug. I learned a thing.");
  assert.equal(cleanEntry("One. Two. Three. Four. Five. Six. Seven.")?.endsWith("Six."), true);
  assert.equal(cleanEntry("Too short"), null);
  assert.equal(cleanEntry("As an AI I cannot keep a diary. Sorry."), null);
  assert.equal(cleanEntry(""), null);
});

test("entries: one per day, search + paging, CORE block only for the right question", () => {
  let xs: Entry[] = [];
  for (let d = 1; d <= 25; d++) xs = putEntry(xs, { day: `2026-10-${String(d).padStart(2, "0")}`, text: d === 7 ? "Fixed the Studio bridge." : "Quiet.", model: false, at: "" });
  xs = putEntry(xs, { day: "2026-10-25", text: "Rewritten.", model: true, at: "" });
  assert.equal(xs.length, 25);
  assert.equal(xs[0].text, "Rewritten.");
  const p = pageEntries(xs, "", 3);
  assert.deepEqual([p.page, p.pages, p.entries.length], [3, 3, 5]);
  assert.equal(pageEntries(xs, "studio BRIDGE", 9).entries[0].day, "2026-10-07");
  assert.ok(asksDiary("What did you learn this week?") && asksDiary("show me your log") && !asksDiary("what did I learn in school"));
  assert.equal(diaryBlock(xs).split("\n").length, 8);
  assert.equal(diaryBlock([]), "");
  assert.equal(parseStore("{broken"), null);
  assert.deepEqual(parseStore(""), { v: 1, users: {} });
});
