import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorRange, birthdayRange, parseWhen, rangeBlock, rewindDays, timeQuestion, type Range } from "../src/lib/when-pure.ts";
import type { Moment } from "../src/lib/chronicle-pure.ts";

// Monday 26 Oct 2026, 15:00 Tallinn.
const NOW = Date.parse("2026-10-26T12:00:00Z");
const r = (s: string) => { const w = parseWhen(s, NOW); return w && "from" in w ? [w.from, w.to] : w; };

test("months, English and Estonian", () => {
  assert.deepEqual(r("What was I doing in March?"), ["2026-03-01", "2026-03-31"]);
  assert.deepEqual(r("in December"), ["2025-12-01", "2025-12-31"]); // future this year → last year
  assert.deepEqual(r("this October"), ["2026-10-01", "2026-10-26"]); // clipped to today
  assert.deepEqual(r("last October"), ["2025-10-01", "2025-10-31"]);
  assert.deepEqual(r("March 2025"), ["2025-03-01", "2025-03-31"]);
  assert.deepEqual(r("early April"), ["2026-04-01", "2026-04-10"]);
  assert.deepEqual(r("late February"), ["2026-02-21", "2026-02-28"]);
  assert.deepEqual(r("mida ma märtsis tegin?"), ["2026-03-01", "2026-03-31"]);
  assert.deepEqual(r("mis juhtus oktoobris"), ["2026-10-01", "2026-10-26"]);
  assert.deepEqual(r("in may"), ["2026-05-01", "2026-05-31"]);
  assert.equal(r("may I ask something"), null);
  assert.equal(r("I march on"), null);
  assert.deepEqual(r("in 2025"), ["2025-01-01", "2025-12-31"]);
});

test("dates and spans", () => {
  assert.deepEqual(r("between Oct 1 and 15"), ["2026-10-01", "2026-10-15"]);
  assert.deepEqual(r("from 1 October to 15 October"), ["2026-10-01", "2026-10-15"]);
  assert.deepEqual(r("from March to May"), ["2026-03-01", "2026-05-31"]);
  assert.deepEqual(r("on Oct 3"), ["2026-10-03", "2026-10-03"]);
  assert.deepEqual(r("on the 3rd of March"), ["2026-03-03", "2026-03-03"]);
  assert.deepEqual(r("on 2025-07-14"), ["2025-07-14", "2025-07-14"]);
  assert.deepEqual(r("14.03"), ["2026-03-14", "2026-03-14"]);
  assert.deepEqual(r("Nov 20"), ["2025-11-20", "2025-11-20"]); // future → last year
  assert.deepEqual(r("since Oct 20"), ["2026-10-20", "2026-10-26"]);
});

test("relative phrases", () => {
  assert.deepEqual(r("yesterday"), ["2026-10-25", "2026-10-25"]);
  assert.deepEqual(r("eile"), ["2026-10-25", "2026-10-25"]);
  assert.deepEqual(r("last week"), ["2026-10-19", "2026-10-25"]);
  assert.deepEqual(r("eelmisel nädalal"), ["2026-10-19", "2026-10-25"]);
  assert.deepEqual(r("last weekend"), ["2026-10-24", "2026-10-25"]);
  assert.deepEqual(r("last month"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(r("3 days ago"), ["2026-10-23", "2026-10-23"]);
  assert.deepEqual(r("two weeks ago"), ["2026-10-12", "2026-10-18"]);
  assert.deepEqual(r("a month ago"), ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(r("the past 10 days"), ["2026-10-17", "2026-10-26"]);
  assert.deepEqual(r("last Friday"), ["2026-10-23", "2026-10-23"]);
  assert.deepEqual(r("last summer"), ["2026-06-01", "2026-08-31"]);
  assert.deepEqual(r("last year"), ["2025-01-01", "2025-12-31"]);
  assert.deepEqual(r("mullu"), ["2025-01-01", "2025-12-31"]);
});

test("birthday and anchors", () => {
  assert.deepEqual(parseWhen("what did I do on my birthday", NOW), { birthday: true, label: "your birthday" });
  const a = parseWhen("what was going on around when I started the candle shop?", NOW);
  assert.ok(a && "anchor" in a && a.anchor === "candle shop");
  assert.deepEqual(birthdayRange("My birthday is 14 May", NOW), { from: "2026-05-13", to: "2026-05-15", label: "your birthday (2026-05-14)" });
  assert.equal(birthdayRange("born 2008-12-01", NOW)?.from, "2025-11-30");
  const ms = [mo("a", "2026-04-02", "memory", "Idea: soy candles"), mo("b", "2026-04-10", "memory", "Started the candle shop on Etsy")];
  assert.equal(anchorRange(ms, "candle shop", "2026-10-26")?.from, "2026-03-27");
  assert.equal(anchorRange(ms, "bakery", "2026-10-26"), null);
});

test("time questions only", () => {
  assert.ok(timeQuestion("What was I doing in March?", NOW));
  assert.equal(timeQuestion("I love March", NOW), null);
  assert.equal(timeQuestion("what should I do next week", NOW), null);
  assert.equal(timeQuestion("what's the weather", NOW), null);
});

const mo = (id: string, day: string, kind: Moment["kind"], title: string, extra: Partial<Moment> = {}): Moment =>
  ({ id, at: Date.parse(`${day}T09:00:00Z`), day, kind, planet: "memory", title, score: 0.3, links: [], ...extra });

test("range block and rewind leave journal out", () => {
  const range: Range = { from: "2026-03-01", to: "2026-03-31", label: "March 2026" };
  const ms = [mo("1", "2026-03-02", "short", "Short out: Clutch", { score: 0.5 }), mo("2", "2026-03-02", "memory", "Note"), mo("3", "2026-03-05", "journal", "Journal entry", { private: true }), mo("4", "2026-04-01", "memory", "April")];
  const b = rangeBlock(ms, range);
  assert.match(b, /Counts: 1 Short published, 1 memory saved\./);
  assert.match(b, /Busiest days: 2026-03-02 \(2\)/);
  assert.doesNotMatch(b, /Journal|April/);
  assert.match(rangeBlock([], range), /Nothing recorded/);
  assert.deepEqual(rewindDays(ms, range).map((d) => [d.day, d.moments.length]), [["2026-03-02", 2]]);
});
