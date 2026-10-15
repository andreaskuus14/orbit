import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, dedupe, linkedCountries, newsFlow, severity, topics, topSources } from "../src/lib/dashboard.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const s = (title: string, h: number, source = "BBC", countries: string[] = []) => ({ title, source, published_at: at(h), countries });

test("newsFlow buckets recent news in 2-hour slots, newest last", () => {
  const f = newsFlow([s("a", 0.5), s("b", 1), s("c", 5), s("d", 23)], NOW);
  assert.equal(f.counts.length, 12);
  assert.deepEqual([f.counts[11], f.counts[9], f.counts[0]], [2, 1, 1]);
  assert.equal(f.counts.reduce((a, b) => a + b), 4);
});

test("newsFlow switches to daily buckets when coverage is older", () => {
  const f = newsFlow([s("a", 1), s("b", 30), s("c", 50), s("d", 100), s("e", 400)], NOW);
  assert.equal(f.counts.length, 7);
  assert.equal(f.counts.reduce((a, b) => a + b), 4, "older than a week is left out");
});

test("severity, sources and linked countries", () => {
  const list = [s("Missile strike kills 12 in Kharkiv", 1, "BBC World"), s("Central bank raises interest rates amid inflation", 2, "Reuters"), s("Local fair opens", 3, "BBC World", ["France", "Spain"])];
  const v = severity(list);
  assert.equal(v.major, 1); assert.equal(v.total, 3);
  assert.equal(topSources(list)[0].name, "BBC World");
  assert.deepEqual(linkedCountries([...list, s("x", 1, "x", ["France", "Germany"])], "Germany").map((c) => c.name), ["France", "Spain"]);
  assert.equal(severity([]).pct, 0);
});

test("compact formats big numbers", () => {
  assert.equal(compact(68_360_000), "68.4M");
  assert.equal(compact(3.1e12), "3.1T");
  assert.equal(compact(242_495), "242K");
  assert.equal(compact(2.5), "2.5");
});

test("dedupe collapses near-duplicate headlines and keeps the first", () => {
  const z = "Volodymyr Zelenskyy feels ‘betrayed’ by Donald Trump over Starlink access";
  const list = [
    { title: z, url: "https://guardian/1" },
    { title: z, url: "https://guardian/2" },
    { title: "Volodymyr Zelenskyy feels 'betrayed' by Donald Trump over Starlink access", url: "a" },
    { title: "Floods hit northern Italy after days of heavy rain - BBC News", url: "b" },
    { title: "Floods hit northern Italy after days of heavy rain", url: "c" },
    { title: "Floods hit northern Italy after days of heavy rain, thousands evacuated | Reuters", url: "d" },
    { title: "Central bank holds rates", url: "e" },
    { title: "Different story", url: "e" },
    { title: "Central bank holds rates steady", url: "f" },
  ];
  assert.deepEqual(dedupe(list).map((s) => s.url), ["https://guardian/1", "b", "e", "f"]);
});

test("topics picks one best group per story, sorted, with Other", () => {
  const t = topics([
    { title: "Missile strike kills 12 as troops advance" },
    { title: "Drone attack on base", summary: "Military says" },
    { title: "Parliament votes on new government budget" },
    { title: "Inflation slows as bank cuts rates" },
    { title: "Local bakery celebrates anniversary" },
  ]);
  assert.deepEqual(t, [{ name: "Conflict", n: 2 }, { name: "Politics", n: 1 }, { name: "Economy", n: 1 }, { name: "Other", n: 1 }]);
});
