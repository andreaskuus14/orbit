import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { addWeek, checkRivalUrls, diffSnaps, extractItems, latestPair, parseRivalStore, priceNum, rivalReport, rivalsLine, robotsAllows, type RivalSnap, type RivalStore } from "../src/lib/rivals-pure.ts";
import { planNight, type PlanInput } from "../src/lib/night-pure.ts";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");
const niche = { id: "n1", title: "Roblox merch", margin: { price: 30, cogs: 12, shipping: 4, feePct: 0.05, cac: 6 } };

test("JSON-LD: ItemList, @graph, Offer arrays, AggregateOffer, ProductGroup variants; broken block skipped, deduped", () => {
  const items = extractItems(fx("rivals-shop.html"), "https://pixel.example/shop");
  assert.deepEqual(items, [
    { title: "Blocky Hoodie & Cap", price: 34.9, currency: "EUR", url: "https://pixel.example/p/hoodie" },
    { title: "Pet Egg Mug", price: 12.99, currency: "EUR", url: "https://pixel.example/p/mug" },
    { title: "Sticker Pack", price: 4.5, currency: "EUR", url: undefined },
    { title: "Roblox Tee", price: 19, currency: "USD", url: undefined },
  ]);
});

test("product meta fallback and YouTube channel titles", () => {
  assert.deepEqual(extractItems(fx("rivals-og.html"), "https://shop.example/x"), [{ title: "Glow Keychain", price: 1299, currency: "EUR", url: "https://shop.example/products/glow" }]);
  assert.deepEqual(extractItems(fx("rivals-youtube.html"), "https://www.youtube.com/@x/videos").map((i) => i.title), ['I Built a "Pet" Empire & Won', "Top 10 Roblox Pets"]);
  assert.deepEqual(extractItems(fx("rivals-youtube.html"), "https://other.example/"), []); // YouTube parsing only on youtube.com
  assert.equal(priceNum("$1,299.50"), 1299.5); assert.equal(priceNum("0"), undefined); assert.equal(priceNum({}), undefined);
});

test("rival links: public http(s), deduped, at most 5, no logins", () => {
  assert.deepEqual(checkRivalUrls(["https://a.example/shop/", "https://a.example/shop", " "]), ["https://a.example/shop"]);
  assert.match(String(checkRivalUrls(["javascript:alert(1)"])), /Not a web link/);
  assert.match(String(checkRivalUrls(["https://u:p@a.example/"])), /login/);
  assert.match(String(checkRivalUrls(["1", "2", "3", "4", "5", "6"].map((n) => `https://s${n}.example/`))), /At most 5/);
  assert.equal(typeof checkRivalUrls("x"), "string");
});

test("robots.txt: our group or *, longest match, Allow wins ties, wildcards", () => {
  const txt = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /feeds/videos.xml\nDisallow: /cart\nAllow: /cart/public\nDisallow: /*?sort=\nDisallow: /end$\n";
  assert.equal(robotsAllows(txt, "/@x/videos"), true);
  assert.equal(robotsAllows(txt, "/feeds/videos.xml?channel_id=1"), false);
  assert.equal(robotsAllows(txt, "/cart/x"), false);
  assert.equal(robotsAllows(txt, "/cart/public/1"), true);
  assert.equal(robotsAllows(txt, "/shop?sort=price"), false);
  assert.equal(robotsAllows(txt, "/end"), false); assert.equal(robotsAllows(txt, "/endless"), true);
  assert.equal(robotsAllows("User-agent: orbit\nDisallow: /\nUser-agent: *\nDisallow:", "/a"), false);
  assert.equal(robotsAllows("", "/a"), true);
});

const snap = (url: string, items: RivalSnap["items"], error?: string): RivalSnap => ({ url, items, ...(error ? { error } : {}) });

test("diff: new items, price moves in the same currency, removed; failed reads aren't changes", () => {
  const A = "https://a.example/", B = "https://b.example/";
  const prev = [snap(A, [{ title: "Hoodie", price: 35, currency: "EUR" }, { title: "Mug", price: 12 }, { title: "Old", price: 5 }]), snap(B, [{ title: "Tee", price: 20 }])];
  const cur = [snap(A, [{ title: "hoodie!", price: 25, currency: "EUR" }, { title: "Mug", price: 12 }, { title: "Cap", price: 18 }]), snap(B, [], "timed out")];
  const d = diffSnaps(prev, cur);
  assert.deepEqual(d.added.map((i) => i.title), ["Cap"]);
  assert.deepEqual(d.moves, [{ title: "hoodie!", from: 35, to: 25, currency: "EUR", url: A }]);
  assert.equal(d.removed, 1);
  assert.deepEqual(diffSnaps(undefined, cur), { added: [], removed: 0, moves: [] });

  const r = rivalReport(niche, cur, prev);
  assert.equal(r.added, 1); assert.equal(r.moves, 1); assert.equal(r.failed, 1);
  assert.match(r.lines[0], /^1 new product: Cap \(€18\.00\) at a\.example/);
  // matching €25: 25 − 12 − 4 − 1.25 − 6 = 1.75 (7 %), vs 6.50 at his €30
  assert.match(r.lines[1], /hoodie! at a\.example: €35\.00 → €25\.00 \(-29%\); matching it would leave you €1\.75 \(7%\) per order instead of €6\.50/);
  assert.match(r.lines[2], /median price €18\.00 over 3 products, below your €30\.00/);
  assert.match(r.lines.at(-1)!, /Couldn't read b\.example \(timed out\)/);
  assert.equal(rivalsLine([r]), "Rivals: 1 new product, 1 price move across 1 competitor page");
});

test("report: first week, quiet week, non-EUR prices kept out of margin math", () => {
  const cur = [snap("https://a.example/", [{ title: "Tee", price: 40, currency: "USD" }])];
  assert.deepEqual(rivalReport(niche, cur).lines, ["First snapshot: changes show from next week"]);
  assert.deepEqual(rivalReport(niche, cur, cur).lines, ["No new products or price moves since last week"]);
  assert.equal(rivalsLine([]), "Rivals: no changes across 0 competitor pages");
});

test("store: 8 weeks kept, latest pair per niche skips weeks without it, broken file throws", () => {
  let s: RivalStore = parseRivalStore("");
  for (let w = 0; w < 10; w++) s = addWeek(s, `2026-10-${10 + w}`, w === 8 ? {} : { n1: [snap("https://a.example/", [{ title: `w${w}` }])] });
  assert.equal(s.weeks.length, 8);
  const p = latestPair(s, "n1");
  assert.equal(p.at, "2026-10-19"); assert.equal(p.cur![0].items[0].title, "w9"); assert.equal(p.prev![0].items[0].title, "w7");
  assert.deepEqual(latestPair(s, "nope"), {});
  assert.throws(() => parseRivalStore("{}"));
});

test("night plan: the watch is queued only when due, with no model calls", () => {
  const i: PlanInput = { tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now: 0, today: "2026-10-26" };
  const S = { maxCalls: 5, maxMinutes: 60 } as Parameters<typeof planNight>[1];
  assert.ok(!planNight(i, S, { calls: 0, ms: 0 }).queue.some((t) => t.kind === "rivals"));
  const t = planNight({ ...i, rivals: 6 }, S, { calls: 0, ms: 0 }).queue.find((x) => x.kind === "rivals");
  assert.deepEqual(t && { calls: t.calls, minutes: t.minutes }, { calls: 0, minutes: 4 });
});
