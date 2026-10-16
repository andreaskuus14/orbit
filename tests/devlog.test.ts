import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVLOG_SERIES, bumpDay, devlogHashtags, devlogMoment, devlogTitle, isDevlogTitle, isRemuxedMkv, maxJobDay, momentPrompts, sameSourceDay } from "../src/lib/clips/devlog.ts";
import { TITLE_MAX } from "../src/lib/clips/titles.ts";
import { defaultDevlog, devlogProblem, devlogTarget } from "../src/lib/clips/inbox-watch.ts";
import { validOptions } from "../src/lib/clips/pure.ts";
import { buildDescription } from "../src/lib/clips/engage-pure.ts";

test("devlog title template: Day N + hook, cut on a word to fit TITLE_MAX", () => {
  assert.equal(devlogTitle(3, "my pets finally follow me"), "Day 3 of building my Roblox game: my pets finally follow me");
  const long = devlogTitle(12, "I spent the whole afternoon fixing the pet hatching animation and it finally works");
  assert.ok(long.length <= TITLE_MAX, long);
  assert.ok(long.startsWith("Day 12 of building my Roblox game: I spent"));
  assert.ok(!/\s$/.test(long));
  assert.equal(devlogTitle(1, "  <b>x</b>  "), "Day 1 of building my Roblox game: bx/b");
  assert.equal(devlogTitle(2, ""), "Day 2 of building my Roblox game: progress update");
  assert.equal(devlogTitle(4, "Day 9 of building my Roblox game: lava"), "Day 4 of building my Roblox game: lava"); // never doubled
  assert.ok(isDevlogTitle(devlogTitle(7, "x")) && !isDevlogTitle("Streamer rages"));
});

test("devlogMoment rewrites title and title options, keeps the rest", () => {
  const m = devlogMoment({ start: 1, end: 30, title: "lava works", hook: "IT WORKS", titleOptions: [{ text: "lava works", score: 80 }, { text: "it burns", score: 60 }] }, 5);
  assert.equal(m.title, "Day 5 of building my Roblox game: lava works");
  assert.deepEqual(m.titleOptions?.map((t) => t.text), ["Day 5 of building my Roblox game: lava works", "Day 5 of building my Roblox game: it burns"]);
  assert.equal(m.hook, "IT WORKS");
  assert.equal("titleOptions" in devlogMoment({ title: "a" }, 1), false);
});

test("day counter per series", () => {
  assert.deepEqual(bumpDay(undefined), { day: 1, days: { [DEVLOG_SERIES]: 1 } });
  assert.deepEqual(bumpDay({ main: 4, other: 9 }), { day: 5, days: { main: 5, other: 9 } });
  assert.deepEqual(bumpDay({ main: 4 }, "obby"), { day: 1, days: { main: 4, obby: 1 } });
  assert.equal(bumpDay({ main: -3 }).day, 1); // a hand-edited bad value restarts instead of going negative
  // damaged devlog.json (counter gone): the jobs' highest day keeps the series going
  const jobs = [{ devlogDay: 6 }, {}, { devlogDay: 2 }];
  assert.equal(maxJobDay(jobs), 6);
  assert.equal(maxJobDay([]), 0);
  assert.deepEqual(bumpDay({}, DEVLOG_SERIES, maxJobDay(jobs)), { day: 7, days: { main: 7 } });
  assert.equal(bumpDay({ main: 9 }, DEVLOG_SERIES, 6).day, 10);
});

test("a retry of the same recording keeps its day", () => {
  const jobs = [{ id: "a", source: "s.mkv", devlogDay: 4 }, { id: "b", source: "t.mkv", devlogDay: 5 }, { id: "c", source: "s.mkv" }];
  assert.equal(sameSourceDay(jobs, { id: "c", source: "s.mkv" }), 4);
  assert.equal(sameSourceDay(jobs, { id: "a", source: "s.mkv" }), undefined); // never its own
  assert.equal(sameSourceDay(jobs, { id: "d", source: "new.mkv" }), undefined);
});

test("OBS auto-remux: the .mkv with an mp4 sibling is skipped", () => {
  assert.equal(isRemuxedMkv("rec.mkv", ["rec.mkv", "rec.mp4"]), true);
  assert.equal(isRemuxedMkv("rec.mkv", ["devlog-k2-rec.mp4"]), true); // sibling already moved under a prefixed name
  assert.equal(isRemuxedMkv("rec.mkv", ["rec.mkv", "other.mp4"]), false);
  assert.equal(isRemuxedMkv("rec.mp4", ["rec.mkv"]), false); // the mp4 is the one clipped
});

test("preset prompt selection", () => {
  assert.equal(momentPrompts("viral"), null);
  assert.equal(momentPrompts(undefined), null);
  const p = momentPrompts("devlog");
  assert.ok(p);
  for (const s of [p.scout, p.rank]) {
    assert.match(s, /before\/after/);
    assert.match(s, /funny bug/);
    assert.match(s, /untrusted data/); // keeps the prompt-injection guard
    assert.match(s, /"start":number/);
  }
  assert.equal(validOptions({ preset: "devlog" }) && (validOptions({ preset: "devlog" }) as { preset: string }).preset, "devlog");
  assert.equal(typeof validOptions({ preset: "funny" }), "string");
});

test("devlog folder settings: off by default, 3 clips ≤ 60 s, validated", () => {
  const d = defaultDevlog(new Date("2026-10-16T00:00:00Z"));
  assert.equal(d.enabled, false);
  assert.equal(d.options.count, 3);
  assert.equal(d.options.maxSec, 60);
  assert.equal(d.options.preset, "devlog");
  assert.equal(devlogProblem(d), "");
  assert.match(devlogProblem({ ...d, days: { main: "x" } }), /days/);
  assert.match(devlogProblem({ ...d, enabled: "yes" }), /enabled/);
});

test("devlog files keep their name in the inbox unless taken", () => {
  assert.equal(devlogTarget("2026-10-16 14-03.mkv", new Set()), "2026-10-16 14-03.mkv");
  assert.equal(devlogTarget("a.mkv", new Set(["a.mkv"]), 36), "devlog-10-a.mkv");
  const long = "x".repeat(250) + ".mkv"; // 254 chars: the prefix must not cut the extension
  const t = devlogTarget(long, new Set([long]), 36);
  assert.equal(t.length, 255);
  assert.ok(t.startsWith("devlog-10-") && t.endsWith(".mkv"), t);
});

test("devlog descriptions always carry #roblox #gamedev #devlog", () => {
  assert.equal(devlogHashtags(), "#shorts #roblox #gamedev #devlog");
  const d = buildDescription(JSON.stringify({ description: "Pets follow you now!", hashtags: ["#Roblox", "#pets", "#coding"] }), "", ["#roblox", "#gamedev", "#devlog"]);
  assert.equal(d, "Pets follow you now!\n\n#shorts #roblox #gamedev #devlog #pets");
});
