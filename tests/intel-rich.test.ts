import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ago, breaking, imageType, initials, miniMap, nearYou, ogImageOf, placeOf, readMinutes, thumbAllowed, thumbFresh, THUMB_TTL } from "../src/lib/intel-rich-pure.ts";

test("ogImageOf: og:image first, relative made absolute, entities decoded, twitter fallback, body ignored", () => {
  assert.equal(ogImageOf(`<head><meta content="/i/a.jpg?x=1&amp;y=2" property="og:image"></head>`, "https://news.err.ee/1/story"), "https://news.err.ee/i/a.jpg?x=1&y=2");
  assert.equal(ogImageOf(`<head><meta name='twitter:image' content='https://c.dn/t.png'><meta property="og:image:secure_url" content="https://c.dn/s.webp"></head>`, "https://a.com"), "https://c.dn/s.webp");
  assert.equal(ogImageOf(`<head><meta name="twitter:image" content="https://c.dn/t.png"></head>`, "https://a.com"), "https://c.dn/t.png");
  assert.equal(ogImageOf(`<head></head><body><meta property="og:image" content="https://x/y.jpg"></body>`, "https://a.com"), null);
  assert.equal(ogImageOf(`<meta property="og:image" content="javascript:alert(1)">`, "https://a.com"), null);
});

test("imageType: raster pictures only, never SVG", () => {
  assert.equal(imageType("image/jpeg; charset=binary"), "image/jpeg");
  assert.equal(imageType("image/svg+xml"), null);
  assert.equal(imageType("text/html"), null);
});

test("thumbAllowed: http(s) only, blocked domains and their subdomains skipped", () => {
  assert.ok(thumbAllowed("https://news.err.ee/x", ""));
  assert.ok(!thumbAllowed("file:///etc/passwd", ""));
  assert.ok(!thumbAllowed("https://www.example.com/a", "foo.org, example.com"));
  assert.ok(thumbAllowed("https://notexample.com/a", "example.com"));
});

test("thumbFresh: pictures 7 days, misses 1 day", () => {
  assert.ok(thumbFresh({ at: 0, type: "image/png" }, THUMB_TTL - 1));
  assert.ok(!thumbFresh({ at: 0, type: null }, 86_400_001));
  assert.ok(!thumbFresh(null, 0));
});

test("readMinutes, ago, initials", () => {
  assert.equal(readMinutes("word ".repeat(10)), 1);
  assert.equal(readMinutes("word ".repeat(660)), 3);
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.equal(ago("2026-11-23T11:24:00Z", now), "36 min");
  assert.equal(ago("2026-11-23T08:00:00Z", now), "4 h");
  assert.equal(ago(null, now), null);
  assert.equal(initials("BBC World"), "BW");
  assert.equal(initials(null), "?");
});

test("placeOf: a known city beats its country; plain country otherwise; none when no place", () => {
  assert.deepEqual(placeOf("Harbour: new ferry line from Tallinn to Helsinki")?.label, "Tallinn");
  assert.equal(placeOf("Estonia passes a tech budget")?.name, "Estonia");
  assert.equal(placeOf("Roblox opens a creator fund"), null);
});

const A = (id: string, title: string, h: number) => ({ id, title, url: `https://e.ee/${id}`, source: "ERR", published_at: new Date(Date.parse("2026-11-23T12:00:00Z") - h * 3_600_000).toISOString() });
test("nearYou: home country only, Tallinn first, then newest, duplicates once", () => {
  const list = nearYou([A("1", "Estonia passes tech budget", 1), A("2", "Japan vote", 0.5), A("3", "Tallinn old town market opens", 5), A("4", "Estonia passes tech budget!", 2), A("5", "Tartu gets new tram", 3)]);
  assert.deepEqual(list.map((x) => x.id), ["3", "1", "5"]);
});

test("breaking: fresh reports newest first; falls back to the newest few", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const r = breaking([A("1", "a", 1), A("2", "b", 0.2), A("3", "c", 9), A("4", "d", 0.5), A("5", "B", 0.1)], now);
  assert.equal(r.fresh, true);
  assert.deepEqual(r.items.map((x) => x.id), ["5", "4", "1"]); // "B" is newer than its duplicate "b"
  const old = breaking([A("1", "a", 10), A("2", "b", 20)], now);
  assert.equal(old.fresh, false);
  assert.deepEqual(old.items.map((x) => x.id), ["1", "2"]);
});

test("miniMap: land near Estonia, point in the middle, nothing from the far side", () => {
  const land = JSON.parse(readFileSync(new URL("../node_modules/world-atlas/land-110m.json", import.meta.url), "utf8"));
  const m = miniMap(land, 58.7, 25.5, 60, 40);
  assert.ok(m.d.length > 50 && m.d.startsWith("M"));
  assert.equal(m.x, 30); assert.equal(m.y, 20);
  const pacific = miniMap(land, -30, -140, 60, 40, 10);
  assert.equal(pacific.d, "");
});
