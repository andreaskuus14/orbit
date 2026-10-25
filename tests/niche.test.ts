import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNiche, kitMarkdown, marginOf, mergeBatch, newTrace, nicheScore, normUrl, parseKit, parseNiches, renderShop, scoutDue, traceLine, type Niche } from "../src/lib/niche-pure.ts";

const line = (o: object) => JSON.stringify(o);
function trace() {
  const t = newTrace();
  traceLine(t, line({ type: "assistant", message: { content: [{ type: "tool_use", id: "s1", name: "WebSearch", input: { query: "roblox merch" } }] } }));
  traceLine(t, line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: 'Web search results\n\nLinks: [{"title":"A","url":"https://a.example/x/"},{"title":"B","url":"https://b.example/y#top"}]' }] } }));
  traceLine(t, line({ type: "assistant", message: { content: [{ type: "tool_use", id: "f1", name: "WebFetch", input: { url: "https://c.example/page", prompt: "read" } }] } }));
  // a URL inside a fetched page's text is not evidence the scout saw as a result
  traceLine(t, line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "f1", content: [{ type: "text", text: "see https://evil.example/z" }] }] } }));
  traceLine(t, "not json");
  return t;
}
const good = { title: "Pixel pet stickers", product: "Die-cut stickers", audience: "Roblox fans 10-16", demand: "Etsy bestsellers", demandScore: 4, competition: "Many sticker shops", competitionScore: 3,
  price: 12, cogs: 3, shipping: 1.5, feePct: 0.05, cac: 3, assumptions: "POD price list", risks: ["IP: no Roblox logos"], fit: "His channel audience", fitScore: 5,
  evidence: [{ url: "https://a.example/x", title: "A" }, { url: "https://c.example/page", title: "C" }, { url: "https://invented.example/", title: "fake" }] };

test("traceLine keeps WebSearch result URLs and WebFetch inputs, nothing else", () => {
  const t = trace();
  assert.deepEqual([...t.seen].sort(), ["https://a.example/x", "https://b.example/y", "https://c.example/page"]);
  assert.deepEqual([...t.opened], ["https://c.example/page"]);
  assert.equal(normUrl("javascript:alert(1)"), null);
  assert.equal(normUrl("https://X.example/a/."), "https://x.example/a");
});

test("checkNiche keeps only evidence CORE really saw and needs two of it", () => {
  const n = checkNiche(good, trace(), "id1", "2026-10-25T00:00:00Z") as Niche;
  assert.equal(typeof n, "object");
  assert.deepEqual(n.evidence.map((e) => [e.url, e.opened]), [["https://a.example/x", false], ["https://c.example/page", true]]);
  assert.match(checkNiche({ ...good, evidence: [good.evidence[0], good.evidence[2]] }, trace(), "i", "t") as string, /fewer than 2 evidence/);
  assert.match(checkNiche({ ...good, evidence: [good.evidence[0], good.evidence[0]] }, trace(), "i", "t") as string, /fewer than 2/); // duplicates count once
});

test("checkNiche refuses insane numbers", () => {
  const t = trace();
  assert.match(checkNiche({ ...good, price: 0 }, t, "i", "t") as string, /price/);
  assert.match(checkNiche({ ...good, cogs: 11 }, t, "i", "t") as string, /below the price/);
  assert.match(checkNiche({ ...good, feePct: 0.6 }, t, "i", "t") as string, /fees/);
  assert.match(checkNiche({ ...good, cac: 40 }, t, "i", "t") as string, /ad cost/);
  assert.match(checkNiche({ ...good, demandScore: 7 }, t, "i", "t") as string, /1–5/);
  assert.match(checkNiche({ ...good, price: "abc" }, t, "i", "t") as string, /missing/);
  assert.match(checkNiche({ ...good, risks: [] }, t, "i", "t") as string, /risks/);
  assert.equal((checkNiche({ ...good, feePct: 5 }, t, "i", "t") as Niche).margin.feePct, 0.05); // "5" = 5 %
});

test("margin and score follow the stated assumptions", () => {
  const m = { price: 12, cogs: 3, shipping: 1.5, feePct: 0.05, cac: 3 };
  assert.deepEqual(marginOf(m), { unit: 3.9, pct: 33 });
  assert.equal(nicheScore({ demandScore: 5, competitionScore: 1, fitScore: 5, margin: { ...m, cac: 0 } }), 100);
  assert.ok(nicheScore({ demandScore: 4, competitionScore: 3, fitScore: 5, margin: m }) < 100);
  assert.equal(nicheScore({ demandScore: 1, competitionScore: 5, fitScore: 1, margin: { ...m, cac: 10 } }), 14); // negative margin earns 0 of 30
});

test("parseNiches keeps the best 3 checked ideas and reports the rest", () => {
  const ideas = [good, { ...good, title: "B", demandScore: 5 }, { ...good, title: "C", fitScore: 1 }, { ...good, title: "D", demandScore: 2 }, { ...good, title: "E", evidence: [] }, { ...good }];
  let i = 0;
  const r = parseNiches(`Here you go:\n\`\`\`json\n${JSON.stringify(ideas)}\n\`\`\``, trace(), "2026-10-25T00:00:00Z", () => `id${i++}`);
  assert.deepEqual(r.niches.map((n) => n.title), ["B", "Pixel pet stickers", "D"]);
  assert.equal(r.rejected.length, 1);
  assert.deepEqual(parseNiches("no json", trace(), "t", () => "x"), { niches: [], rejected: [] });
});

test("scoutDue: weekly after success, 12 h after a failure", () => {
  const now = Date.parse("2026-10-25T12:00:00Z"), h = 3_600_000;
  assert.equal(scoutDue({}, now), true);
  assert.equal(scoutDue({ lastAttempt: new Date(now - 6 * 24 * h).toISOString(), lastOk: new Date(now - 6 * 24 * h).toISOString() }, now), false);
  assert.equal(scoutDue({ lastAttempt: new Date(now - 7 * 24 * h).toISOString(), lastOk: new Date(now - 7 * 24 * h).toISOString() }, now), true);
  assert.equal(scoutDue({ lastAttempt: new Date(now - 2 * h).toISOString(), lastOk: new Date(now - 30 * 24 * h).toISOString() }, now), false);
  assert.equal(scoutDue({ lastAttempt: new Date(now - 13 * h).toISOString() }, now), true);
});

test("mergeBatch drops only stale untouched ideas", () => {
  const now = Date.parse("2026-10-25T00:00:00Z"), old = "2026-09-01T00:00:00Z";
  const mk = (id: string, status: Niche["status"], at = old) => ({ id, status, at }) as Niche;
  assert.deepEqual(mergeBatch([mk("a", "new"), mk("b", "kept"), mk("c", "dismissed"), mk("d", "new", "2026-10-20T00:00:00Z")], [mk("n", "new", "2026-10-25T00:00:00Z")], now).map((n) => n.id), ["n", "b", "c", "d"]);
});

const kit = { brand: "Pixel <Pals>", tagline: "Stickers", headline: "Stick your \"pets\"", sub: "Waterproof.", cta: "Shop",
  products: [{ name: "Pack", price: 12, description: "Five stickers.", bullets: ["Waterproof", 3] }, { name: "", price: 3, description: "x" }],
  sections: [{ title: "Made in EU", body: "Printed to order." }], faq: [{ q: "Shipping?", a: "3-7 days" }, { q: "Returns?", a: "14 days" }, { q: "Pay?", a: "Card" }],
  hooks: ["One", "Two", "Three", "Four"], checklist: ["a", "b", "c", "d", "e"] };

test("parseKit checks and caps CORE's kit", () => {
  const k = parseKit(`Sure! ${JSON.stringify(kit)}`);
  assert.ok(typeof k === "object");
  assert.equal(k.products.length, 1);
  assert.deepEqual(k.products[0].bullets, ["Waterproof"]);
  assert.deepEqual(k.hooks, ["One", "Two", "Three"]);
  assert.match(parseKit(JSON.stringify({ ...kit, hooks: ["a", "b"] })) as string, /3 ad hooks/);
  assert.match(parseKit(JSON.stringify({ ...kit, faq: [] })) as string, /FAQ/);
  assert.match(parseKit("nothing") as string, /no kit/);
});

test("renderShop escapes copy, has no scripts or outside links, checkout points nowhere", () => {
  const html = renderShop(parseKit(JSON.stringify({ ...kit, sub: "<script>alert(1)</script>" })) as never);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /Pixel &lt;Pals&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /(href|src)="(https?:)?\/\//);
  assert.match(html, /href="#checkout"/);
  assert.match(html, /<details><summary>Shipping\?<\/summary>/);
  const md = kitMarkdown(parseKit(JSON.stringify(kit)) as never, { title: "T", evidence: [{ url: "https://a.example/x", title: "A", opened: true }] });
  assert.match(md, /## Ad hooks\n\n1\. One/);
  assert.match(md, /- \[ \] a/);
});
