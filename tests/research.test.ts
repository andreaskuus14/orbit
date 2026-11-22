// DEEP RESEARCH pure parts (research-pure.ts): budget, pacing, the plan, sources, the state machine, citations, fact-check marks, the card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addSources, applyCheck, assembleCitations, budgetFrom, linksIn, mayStart, msLeft, newState, nextToRead, normUrl, pace, parseNotes, parsePlan, patchSrc, queryOrder,
  questionOf, readSources, reportClaims, reportDoc, reportName, researchCard, shrink, toPhase, writePrompt, DEFAULT_RBUDGET, WRITE_RESERVE_MS, type RState } from "../src/lib/research-pure.ts";

const T0 = Date.parse("2026-11-22T10:00:00Z");
const fresh = (b = DEFAULT_RBUDGET) => newState("rtest", "What are the best free open-source game engines for 2D in 2026?", "en", b, T0);

test("budget: 10-40 pages, 3-25 minutes, calls and searches follow pages", () => {
  assert.deepEqual(budgetFrom({}), { pages: 24, minutes: 12, calls: 41, searches: 8 });
  assert.equal(budgetFrom({ pages: 5 }).pages, 10);
  assert.equal(budgetFrom({ pages: 99, minutes: 99 }).pages, 40);
  assert.equal(budgetFrom({ minutes: 1 }).minutes, 3);
  assert.equal(budgetFrom({ pages: 40 }).searches, 12);
  assert.ok("error" in questionOf("hi"));
  assert.ok("q" in questionOf("  compare   the best 2D engines  "));
});

test("pacing: Stop-all and the hard limit stop, the soft budget shrinks", () => {
  assert.equal(pace({ stopAll: true, hard: null, soft: null }).kind, "stop");
  assert.equal(pace({ stopAll: false, hard: "5-hour limit", soft: "x" }).kind, "stop");
  assert.equal(pace({ stopAll: false, hard: "", soft: "You're active" }).kind, "shrink");
  assert.equal(pace({ stopAll: false, hard: null, soft: null }).kind, "go");
  let s = fresh();
  s = { ...s, used: { ...s.used, pages: 3, searches: 2 } };
  const k = shrink(s);
  assert.equal(k.budget.pages, 12);
  assert.equal(k.budget.searches, 2, "no more searches after shrinking");
  assert.equal(shrink(k), k);
});

test("mayStart: pages and searches stop near the end, writing never does", () => {
  const s = fresh();
  assert.equal(mayStart(s, "page", T0), true);
  assert.equal(mayStart({ ...s, used: { ...s.used, pages: 24 } }, "page", T0), false);
  const late = T0 + s.budget.minutes * 60_000 - WRITE_RESERVE_MS + 1;
  assert.equal(mayStart(s, "search", late), false);
  assert.equal(mayStart(s, "page", late), false);
  assert.equal(mayStart({ ...s, phase: "write", used: { ...s.used, calls: 999 } }, "call", late), true);
  assert.equal(mayStart(toPhase(s, "stopped", T0, "Stop-all is on"), "call", T0), false);
  assert.equal(msLeft(s, T0 + 60_000), 11 * 60_000);
});

test("plan: JSON from the planner is checked and capped; junk gives null", () => {
  const p = parsePlan('Sure!\n{"title":"2D engines","subs":[{"q":"Which engines?","queries":["open source 2D game engine 2026","godot vs defold"]},{"q":"Licences?","queries":["godot licence", "godot licence", "x"]}],"outline":["Options","Licences","Pick"]}', "q");
  assert.ok(p);
  assert.equal(p!.subs.length, 2);
  assert.deepEqual(p!.subs[1].queries, ["godot licence"], "duplicates and too-short queries dropped");
  assert.deepEqual(queryOrder(p!), ["open source 2D game engine 2026", "godot licence", "godot vs defold"]);
  assert.equal(parsePlan("no json", "q"), null);
  assert.equal(parsePlan('{"subs":[]}', "q"), null);
  const many = parsePlan(JSON.stringify({ subs: Array.from({ length: 9 }, (_, i) => ({ q: `q${i}`, queries: ["a b c", "d e f", "g h i"] })) }), "fallback");
  assert.equal(many!.subs.length, 6);
  assert.equal(many!.subs[0].queries.length, 2);
  assert.equal(many!.title, "fallback");
});

test("sources: normalised, deduped, no sign-in or search pages, max per site", () => {
  assert.equal(normUrl("https://www.Example.com/a/?utm_source=x&id=2#top"), "https://example.com/a?id=2");
  assert.equal(normUrl("ftp://x.com/a"), null);
  assert.equal(normUrl("https://en.wikipedia.org/wiki/Godot_(game_engine)"), "https://en.wikipedia.org/wiki/Godot_(game_engine)");
  assert.equal(normUrl("https://a.example/x)."), "https://a.example/x");
  assert.deepEqual(linksIn("[G](https://en.wikipedia.org/wiki/Godot_(game_engine)) and https://en.wikipedia.org/wiki/Bevy_(engine)").map((l) => l.url), ["https://en.wikipedia.org/wiki/Godot_(game_engine)", "https://en.wikipedia.org/wiki/Bevy_(engine)"]);
  const found = linksIn("- [Godot](https://godotengine.org/) is MIT [docs](https://docs.godotengine.org/en/stable/?utm_medium=x).\nhttps://godotengine.org\n[login](https://site.com/login?next=/) [g](https://www.google.com/search?q=x) " +
    Array.from({ length: 6 }, (_, i) => `[p${i}](https://blog.example/p${i})`).join(" "));
  const s = addSources(fresh(), found);
  const urls = s.sources.map((x) => x.url);
  assert.ok(urls.includes("https://godotengine.org"));
  assert.equal(urls.filter((u) => u.startsWith("https://godotengine.org")).length, 1, "same page once");
  assert.ok(!urls.some((u) => /login|google/.test(u)));
  assert.equal(urls.filter((u) => u.includes("blog.example")).length, 4);
  assert.deepEqual(s.sources.map((x) => x.id), s.sources.map((_, i) => i + 1));
});

test("state machine: reading spreads over sites and respects the page budget", () => {
  let s = addSources(fresh({ ...DEFAULT_RBUDGET, pages: 10 }), [...Array.from({ length: 4 }, (_, i) => ({ url: `https://a.example/${i}`, title: "" })), { url: "https://b.example/x", title: "" }, { url: "https://c.example/y", title: "" }]);
  s = toPhase(s, "read", T0 + 1000);
  assert.equal(s.last, "read");
  const first = nextToRead(s, 3).map((x) => new URL(x.url).hostname);
  assert.deepEqual(first, ["a.example", "b.example", "c.example"]);
  s = { ...patchSrc(s, 1, { status: "read", text: "t" }), used: { ...s.used, pages: 9 } };
  assert.equal(nextToRead(s, 5).length, 1, "only one page left in the budget");
  assert.equal(readSources(s).length, 1);
  const stopped = toPhase(s, "stopped", T0 + 2000, "Stop-all is on");
  assert.equal(stopped.last, "read");
  assert.equal(stopped.note, "Stop-all is on");
});

test("notes are parsed per source; 'nothing relevant' and unknown ids dropped", () => {
  const m = parseNotes("### S1\n- Godot is MIT licensed\n### S2\nnothing relevant\n### S9\n- stray\n## S3 Title\n- Defold is free", [1, 2, 3]);
  assert.deepEqual([...m.keys()], [1, 3]);
  assert.match(m.get(3)!, /Defold/);
});

test("citations: renumbered by first use, unread ones dropped, Sources list appended", () => {
  const srcs = [{ id: 4, url: "https://godotengine.org", title: "Godot" }, { id: 7, url: "https://defold.com", title: "Defold [site]" }];
  const a = assembleCitations("## Summary\nGodot is MIT licensed [4]. Defold is free [7][4] and fast [12].\nBoth are good [4, 7].\n\n## Sources\n1. made up", srcs);
  assert.match(a.text, /Godot is MIT licensed \[1\]\. Defold is free \[2\]\[1\] and fast\.\nBoth are good \[1\]\[2\]\./);
  assert.equal(a.dropped, 1);
  assert.deepEqual(a.cited.map((c) => c.n), [1, 2]);
  assert.match(a.text, /## Sources\n\n1\. \[Godot\]\(https:\/\/godotengine\.org\)\n2\. \[Defold site\]\(https:\/\/defold\.com\)\n$/);
  assert.doesNotMatch(a.text, /made up/);
  assert.match(assembleCitations("Ranges work [4-5].", [{ id: 4, url: "https://a.b", title: "A" }, { id: 5, url: "https://c.d", title: "C" }]).text, /\[1\]\[2\]/);
  assert.equal(assembleCitations("No citations here.", srcs).cited.length, 0);
  assert.match(assembleCitations("x [1].", [{ id: 1, url: "https://en.wikipedia.org/wiki/Godot_(game_engine)", title: "G" }]).text, /\(https:\/\/en\.wikipedia\.org\/wiki\/Godot_%28game_engine%29\)/);
});

test("fact check: claims map to cited URLs and unbacked ones are marked after their citation", () => {
  const a = assembleCitations("Godot is released under the MIT licence [4]. Defold needs a paid licence for consoles [7].\n## Open questions\nNone.", [{ id: 4, url: "https://godotengine.org", title: "Godot" }, { id: 7, url: "https://defold.com", title: "Defold" }]);
  const claims = reportClaims(a.text, a.cited);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0].sources, ["https://godotengine.org"]);
  const v = new Map([[claims[0].key, "backed" as const], [claims[1].key, "not_backed" as const]]);
  const r = applyCheck(a.text, claims, v, "en");
  assert.equal(r.backed, 1);
  assert.equal(r.flagged, 1);
  assert.match(r.text, /consoles \[2\] _\(not backed by the source\)_\./);
  assert.doesNotMatch(r.text, /licence \[1\] _/);
});

test("write prompt only carries pages with notes; doc + file name", () => {
  let s = addSources(fresh(), [{ url: "https://a.example/1", title: "A" }, { url: "https://b.example/2", title: "B" }]);
  s = patchSrc(patchSrc(s, 1, { status: "read", notes: "- fact one" }), 2, { status: "failed" });
  const p = writePrompt(s);
  assert.match(p, /\[1\] A \(a\.example\)/);
  assert.doesNotMatch(p, /b\.example/);
  const doc = reportDoc({ ...s, check: { backed: 3, flagged: 1, unchecked: 0 } }, "## Summary\nx", "2026-11-22T10:00:00Z");
  assert.match(doc, /^# What are the best/);
  assert.match(doc, /Read 1 pages\. Fact check: 3 backed, 1 marked\./);
  assert.equal(reportName({ ...s, plan: { title: "2D engines: a/b?", subs: [], outline: [] } }, "2026-11-22T10:00:00Z"), "Research - 2D engines a b - 2026-11-22.md");
});

test("card: steps, pages-read line, time left from the budget, result with Open", () => {
  let s: RState = addSources(fresh(), [{ url: "https://a.example/1", title: "A" }]);
  s = toPhase(patchSrc(s, 1, { status: "read" }), "read", T0 + 60_000);
  const c = researchCard(s, T0 + 60_000);
  assert.equal(c.phase, "working");
  assert.equal(c.now, "Read 1 of 24 pages");
  assert.deepEqual(c.steps.map((x) => x.state), ["done", "done", "now", "next", "next", "next", "next"]);
  assert.equal(c.leftMin, 11);
  const done = researchCard({ ...toPhase(s, "done", T0 + 600_000), savedAs: "Research - x - 2026-11-22.md", report: "a\n## Sources\n\n1. [A](https://a.example/1)\n" }, T0 + 600_000);
  assert.equal(done.phase, "done", "a finished report never lands in Needs you");
  assert.equal(done.action!.kind, "open");
  assert.match(done.result!.text, /1 pages read, 1 sources cited/);
  assert.match(done.action!.open, /^\/api\/vault\?file=Research/);
  const failed = researchCard(toPhase(s, "failed", T0 + 1000, "none of the pages could be read"), T0 + 1000);
  assert.equal(failed.phase, "failed");
  assert.equal(failed.result!.text, "none of the pages could be read");
  assert.equal(failed.steps[2].state, "failed");
  const et = researchCard({ ...s, lang: "et" }, T0 + 60_000);
  assert.equal(et.now, "Loetud 1 / 24 lehte");
});
