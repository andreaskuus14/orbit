import { test } from "node:test";
import assert from "node:assert/strict";
import { capShare, googleNewsSearchUrl, googleNewsTopUrl, isEditionOf, LOCAL_FEEDS } from "../src/lib/local-news-pure.ts";
import { parseFeed } from "../src/lib/pure.ts";

test("Google News URLs carry the country's language and edition", () => {
  assert.equal(googleNewsTopUrl("ee", "et"), "https://news.google.com/rss?hl=et-EE&gl=EE&ceid=EE:et");
  const u = new URL(googleNewsSearchUrl("tasuta üritused & Tallinn", "EE", "et", "12h"));
  assert.equal(u.pathname, "/rss/search");
  assert.equal(u.searchParams.get("q"), "tasuta üritused & Tallinn when:12h");
  assert.equal(u.searchParams.get("gl"), "EE");
  assert.equal(u.searchParams.get("ceid"), "EE:et");
});

test("a redirect to the US edition means the country has none", () => {
  assert.equal(isEditionOf("https://news.google.com/rss?hl=et-EE&gl=EE&ceid=EE:et", "ee"), true);
  assert.equal(isEditionOf("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", "MT"), false);
  assert.equal(isEditionOf("not a url", "EE"), false);
});

test("Estonia has curated native feeds, all https", () => {
  assert.ok(LOCAL_FEEDS.EE.length >= 3);
  for (const f of LOCAL_FEEDS.EE) assert.match(f.url, /^https:\/\//);
});

test("capShare keeps any one country to 30% while alternatives exist", () => {
  const items = [..."UUUUUUUUUU"].map((c, i) => ({ id: `u${i}`, c: "US" })).concat([{ id: "e", c: "EE" }, { id: "f", c: "FR" }, { id: "x", c: null as unknown as string }]);
  const out = capShare(items, (s) => s.c, 10, 0.3);
  assert.equal(out.length, 10);
  assert.deepEqual(out.slice(0, 6).map((s) => s.id), ["u0", "u1", "u2", "e", "f", "x"], "3 US, then the others, untagged never capped");
  assert.deepEqual(out.slice(6).map((s) => s.id), ["u3", "u4", "u5", "u6"], "only then fill with the overflow");
  assert.equal(capShare([], (s: { c: string }) => s.c, 5).length, 0);
  assert.equal(capShare(items.slice(0, 2), (s) => s.c, 10).length, 2);
});

test("RSS parse of local feeds: CDATA, HTML stripped, Google's source tag", () => {
  const err = `<?xml version="1.0"?><rss version="2.0"><channel><title>news | ERR</title>
    <item><title><![CDATA[Tallinn opens <b>free</b> museum day]]></title><link>https://news.err.ee/1610169265/x</link>
    <description><![CDATA[<p>Entry is free on Sunday.</p><script>alert(1)</script>]]></description>
    <pubDate>Sat, 17 Oct 2026 14:59:00 +0300</pubDate></item>
    <item><title>No link</title></item>
    <item><title>Bad scheme</title><link>javascript:alert(1)</link></item></channel></rss>`;
  const p = parseFeed(err);
  assert.equal(p.title, "news | ERR");
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].title, "Tallinn opens free museum day");
  assert.equal(p.items[0].published, "2026-10-17T11:59:00.000Z");
  assert.doesNotMatch(p.items[0].summary, /<|alert/);
  const gn = parseFeed(`<rss><channel><item><title>Valitsus kinnitas eelarve - ERR</title><link>https://news.google.com/rss/articles/abc?oc=5</link><source url="https://www.err.ee">ERR</source></item></channel></rss>`);
  assert.equal(gn.items[0].source, "ERR");
});
