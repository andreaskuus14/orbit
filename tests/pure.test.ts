import { test } from "node:test";
import assert from "node:assert/strict";
import { toOrQuery, rrfMerge, parseCitations, numberCitations, costUsd, isPrivateIp, htmlToText, cleanTags, str } from "../src/lib/pure.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("rrfMerge rewards items ranked well in several lists", () => {
  const out = rrfMerge([["a", "b", "c"], ["b", "d"]]);
  assert.equal(out[0].id, "b");
  assert.deepEqual(out.map((o) => o.id).sort(), ["a", "b", "c", "d"]);
});

test("parseCitations dedupes and keeps order; numberCitations renumbers", () => {
  const text = `See [m:${B}] and [m:${A}], again [m:${B}]. Bogus [m:nope].`;
  const ids = parseCitations(text);
  assert.deepEqual(ids, [B, A]);
  assert.equal(numberCitations(text, ids), "See [1] and [2], again [1]. Bogus [m:nope].");
  assert.equal(numberCitations(`x [m:${A}]`, []), "x ");
});

test("costUsd uses per-million pricing and flags unknown models", () => {
  assert.equal(costUsd("claude-sonnet-5-5", 1_000_000, 100_000), 3);
  assert.equal(costUsd("gpt-whatever", 10, 10), null);
});

test("isPrivateIp blocks internal ranges and allows public ones", () => {
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111"])
    assert.equal(isPrivateIp(ip), false, ip);
});

test("htmlToText pulls title and strips scripts/tags/entities", () => {
  const r = htmlToText("<html><head><title>Hi &amp; bye</title><script>evil()</script></head><body><p>One</p><p>Two &lt;3</p></body></html>");
  assert.equal(r.title, "Hi & bye");
  assert.ok(!r.text.includes("evil"));
  assert.ok(r.text.includes("One") && r.text.includes("Two <3"));
});

test("cleanTags and str validate input", () => {
  assert.deepEqual(cleanTags("AI, #ai, research ,,"), ["ai", "research"]);
  assert.deepEqual(cleanTags(42), []);
  assert.equal(str("  hi ", 5, 1), "hi");
  assert.equal(str("", 5, 1), null);
  assert.equal(str(undefined, 5), "");
  assert.equal(str(3, 5), null);
});

test("toOrQuery lets any word match and drops punctuation", () => {
  assert.equal(toOrQuery("What did I save about pets?"), "what or did or i or save or about or pets");
  assert.equal(toOrQuery("  ?! "), "");
});

import { parseFeed, normalizeUrl, clusterArticles, dueSlots, lastSlotTime, SLOTS } from "../src/lib/pure.ts";

test("article citations use their own prefix", () => {
  const t = `Big news [a:${A}] and memory [m:${B}]`;
  assert.deepEqual(parseCitations(t, "a"), [A]);
  assert.equal(numberCitations(t, [A], "a"), `Big news [1] and memory [m:${B}]`);
});

test("parseFeed reads RSS with CDATA, entities and Google News sources", () => {
  const xml = `<rss><channel><title>Tech &amp; AI</title>
    <item><title><![CDATA[Chip maker ships <b>new</b> GPU]]></title><link>https://ex.com/a?utm_source=x</link>
      <pubDate>Wed, 14 Oct 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Fast &amp; cheap&lt;/p&gt;</description><source url="https://ex.com">Example News</source></item>
    <item><title>No link</title></item></channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.title, "Tech & AI");
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].title, "Chip maker ships new GPU");
  assert.equal(f.items[0].summary, "Fast & cheap");
  assert.equal(f.items[0].source, "Example News");
  assert.equal(f.items[0].published, "2026-10-14T08:00:00.000Z");
});

test("parseFeed reads Atom", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Hello</title>
    <link rel="alternate" href="https://b.org/hello"/><updated>2026-10-13T10:00:00Z</updated><summary>Hi there</summary></entry></feed>`;
  const f = parseFeed(xml);
  assert.deepEqual(f.items.map((i) => [i.title, i.url, i.summary]), [["Hello", "https://b.org/hello", "Hi there"]]);
});

test("normalizeUrl strips tracking and www", () => {
  assert.equal(normalizeUrl("https://www.ex.com/a/?utm_source=x&id=2#top"), "https://ex.com/a/?id=2");
  assert.equal(normalizeUrl("https://ex.com/b/"), "https://ex.com/b");
});

test("clusterArticles groups the same event", () => {
  const items = [
    { title: "OpenAI releases new reasoning model", published_at: "2026-10-14T08:00:00Z" },
    { title: "Roblox updates creator payouts", published_at: "2026-10-14T07:00:00Z" },
    { title: "New reasoning model released by OpenAI today", published_at: "2026-10-14T09:00:00Z" },
  ];
  const c = clusterArticles(items);
  assert.equal(c.length, 2);
  assert.equal(c[0].length, 2);
});

test("dueSlots fires once per slot and catches up within grace", () => {
  const now = new Date(2026, 9, 14, 8, 0); // Wed 08:00 local
  assert.deepEqual(dueSlots(now, {}), ["morning"]);
  assert.deepEqual(dueSlots(now, { morning: new Date(2026, 9, 14, 7, 31).toISOString() }), []);
  assert.deepEqual(dueSlots(new Date(2026, 9, 14, 13, 0), {}), ["midday"]); // morning is past grace
  const sun = new Date(2026, 9, 18, 18, 45); // Sunday
  assert.ok(dueSlots(sun, {}).includes("weekly"));
  assert.equal(lastSlotTime(SLOTS[3], new Date(2026, 9, 14, 12)).getDay(), 0);
});

import { parseAgentReply, slugify } from "../src/lib/pure.ts";

test("parseAgentReply reads tool calls, finals, fenced JSON and falls back to text", () => {
  assert.deepEqual(parseAgentReply('{"thought":"look","tool":"search_memory","input":{"query":"pets"}}'),
    { thought: "look", tool: "search_memory", input: { query: "pets" } });
  assert.deepEqual(parseAgentReply('```json\n{"thought":"","final":"Done {ok}"}\n```'), { thought: "", final: "Done {ok}" });
  assert.deepEqual(parseAgentReply("Sure! here you go"), { thought: "", final: "Sure! here you go" });
  assert.deepEqual(parseAgentReply('{"tool":"x","input":[1]}'), { thought: "", tool: "x", input: {} });
});

test("slugify", () => {
  assert.equal(slugify("Market Scout!"), "market-scout");
  assert.equal(slugify("  Été  Agent_2 "), "ete-agent-2");
});

import { decodeGoogleNewsId, extractArticle } from "../src/lib/pure.ts";

test("decodeGoogleNewsId handles old base64 ids and flags new ones", () => {
  const old = btoa("\x08\x13\x22\x1chttps://example.com/story-1\xd2\x01\x00").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.deepEqual(decodeGoogleNewsId(old), { url: "https://example.com/story-1", needsApi: false });
  const fresh = btoa("\x08\x13\x22AU_yqLsomething").replace(/=+$/, "");
  assert.deepEqual(decodeGoogleNewsId(fresh), { url: null, needsApi: true });
});

test("extractArticle keeps story paragraphs and drops menus", () => {
  const html = `<html><head><title>Big Story</title></head><body><nav>Home News Sport</nav>
    <article><h1>Big Story</h1><p>Short caption</p><p>${"The company announced a major change to how creators are paid on the platform. ".repeat(2)}</p>
    <p>${"Analysts said the move could affect thousands of developers who rely on the program. ".repeat(2)}</p><button>Share</button></article></body></html>`;
  const a = extractArticle(html);
  assert.equal(a.title, "Big Story");
  assert.equal(a.text.split("\n").length, 2);
  assert.ok(!a.text.includes("Share") && !a.text.includes("Short caption"));
});

import { validateAutomation, automationDue, lastDue, describeTrigger } from "../src/lib/pure.ts";

test("validateAutomation cleans schedule and event specs and rejects bad input", () => {
  const ok = validateAutomation({ name: " Weekly review ", trigger: "schedule", schedule: { every: "week", weekday: 0, hour: 18, minute: 0 }, agent: "nova", prompt: "Review my projects" });
  assert.ok("spec" in ok && ok.spec.name === "Weekly review" && ok.spec.schedule?.weekday === 0);
  const ev = validateAutomation({ name: "Doc", trigger: "event", event: "memory.created", kind_filter: "document", agent: "echo", prompt: "Summarize it" });
  assert.ok("spec" in ev && ev.spec.kind_filter === "document" && ev.spec.schedule === null);
  assert.ok("error" in validateAutomation({ name: "x", trigger: "event", event: "rm -rf", prompt: "hello" }));
  assert.ok("error" in validateAutomation({ name: "", prompt: "hello" }));
  const bad = validateAutomation({ name: "n", trigger: "schedule", schedule: { every: "day", hour: 99 }, agent: "Bad Agent!", prompt: "hello" });
  assert.ok("spec" in bad && bad.spec.schedule?.hour === 9 && bad.spec.agent === "nova");
  const str = validateAutomation({ name: "n", trigger: "schedule", schedule: { every: "week", weekday: "0", hour: "18", minute: "30" }, prompt: "hello" });
  assert.ok("spec" in str && str.spec.schedule?.hour === 18 && str.spec.schedule?.minute === 30 && str.spec.schedule?.weekday === 0);
});

test("automationDue fires once per slot, not before creation, with catch-up", () => {
  const daily = { every: "day" as const, hour: 8, minute: 0 };
  const created = new Date(2026, 9, 1).toISOString();
  const at = (h: number, m = 0, d = 14) => new Date(2026, 9, d, h, m);
  assert.equal(automationDue(daily, null, created, at(8, 1)), true);
  assert.equal(automationDue(daily, at(8, 1).toISOString(), created, at(8, 30)), false);
  assert.equal(automationDue(daily, null, created, at(10, 30)), true);   // caught up within 3h
  assert.equal(automationDue(daily, null, created, at(12, 0)), false);   // too late
  assert.equal(automationDue(daily, null, at(9).toISOString(), at(9, 30)), false); // created after today's slot
  const weekly = { every: "week" as const, weekday: 0, hour: 18, minute: 0 };
  assert.equal(lastDue(weekly, at(12)).getDay(), 0);
  assert.equal(automationDue({ every: "hour", minute: 15 }, null, created, at(13, 20)), true);
  assert.equal(describeTrigger({ trigger: "schedule", schedule: weekly, event: null, kind_filter: null }), "Every Sunday at 18:00");
});

import { extractLinks } from "../src/lib/pure.ts";

test("extractLinks returns absolute headline links only", () => {
  const html = `<nav><a href="/home">Home</a></nav><script>var a='<a href="/x">not a real link in a script tag at all</a>'</script>
    <a href="/news/world-123" class="h">Starlink restrictions linked to politics, aide says</a>
    <a href="https://other.org/a?x=1&amp;y=2"><span>Pope recovering as expected after surgery, doctors say</span></a>
    <a href="/news/world-123">Starlink restrictions linked to politics, aide says</a><a href="#top">Back to the top of this page please</a>`;
  assert.deepEqual(extractLinks(html, "https://www.bbc.com/news/world"), [
    { text: "Starlink restrictions linked to politics, aide says", url: "https://www.bbc.com/news/world-123" },
    { text: "Pope recovering as expected after surgery, doctors say", url: "https://other.org/a?x=1&y=2" },
  ]);
});
