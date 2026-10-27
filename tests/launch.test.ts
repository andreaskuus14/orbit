import { test } from "node:test";
import assert from "node:assert/strict";
import { DOCS, SHOPIFY_COLUMNS, WOO_COLUMNS, buildPackage, checkDoc, clip, floorPrice, priceProducts, seoFor, shopifyCsv, tagsFor, toCsv, variantsFor, wooCsv, type DocCheck } from "../src/lib/launch-pure.ts";
import { marginOf, type Kit, type Niche } from "../src/lib/niche-pure.ts";

const margin = { price: 20, cogs: 6, shipping: 4, feePct: 0.05, cac: 3 };
const niche = { id: "00000000-0000-0000-0000-000000000001", at: "2026-10-20T00:00:00Z", title: "Pixel pet hoodies", product: "Print-on-demand hoodies", audience: "Roblox fans 12-16",
  demand: "", demandScore: 4, competition: "", competitionScore: 3, margin, assumptions: "", risks: ["IP"], fit: "", fitScore: 5, evidence: [], score: 70, status: "kept" } as Niche;
const kit: Kit = { brand: "PixelPaw", tagline: "Pets you can wear", headline: "Wear your pet", sub: "Hoodies", cta: "Shop",
  products: [{ name: "Neon Cat Hoodie", price: 20, description: 'Soft hoodie, "neon" cat print. Made to order.', bullets: ["Organic cotton", "Unisex fit, S-XL", "Ships in 3 days"] },
    { name: "Cheap Sticker", price: 8, description: "A sticker, priced too low.", bullets: [] }],
  sections: [{ title: "Why", body: "Because." }], faq: [{ q: "Returns?", a: "14 days." }, { q: "Shipping?", a: "EU." }, { q: "Sizes?", a: "S-XL" }],
  hooks: ["POV: your pet", "Nobody has this", "Wait for it"], checklist: ["Pick a platform", "Order a sample", "Set up ads", "Film 3 videos", "Launch"] };
const doc: DocCheck = { url: DOCS.shopify.url, at: "2026-10-26T00:00:00Z", ok: true, missing: [] };

/** Minimal RFC 4180 reader for the round-trip checks. */
function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\r") { /* CRLF */ } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else f += c;
  }
  return rows;
}

test("toCsv quotes commas, quotes and line breaks, CRLF rows", () => {
  assert.equal(toCsv([["a", 'say "hi"', "x,y", "l1\nl2", 3]]), 'a,"say ""hi""","x,y","l1\nl2",3\r\n');
  assert.deepEqual(parseCsv(toCsv([["a,b", '"q"'], ["", "z"]])), [["a,b", '"q"'], ["", "z"]]);
});

test("variants come from the margin math: floor keeps 20 %, 3-pack only when it earns more", () => {
  const f = floorPrice(margin);
  assert.ok(marginOf({ ...margin, price: f }).pct >= 20 && String(f).endsWith(".99"));
  const v = variantsFor(20, margin);
  assert.equal(v[0].price, Math.max(20, f));
  assert.equal(v[0].profit, marginOf({ ...margin, price: v[0].price }).unit);
  assert.equal(v[1]?.option, "3-pack");
  assert.ok(v[1].profit > v[0].profit && v[1].price < v[0].price * 3);
  const low = variantsFor(8, margin)[0]; // loses money at €8 → raised
  assert.ok(low.raised && low.price > 8 && low.pct >= 20);
});

test("Shopify CSV: documented columns, one row per variant sharing the handle, draft status, SEO within limits", () => {
  const rows = parseCsv(shopifyCsv(kit, niche, priceProducts(kit, margin)));
  assert.deepEqual(rows[0], [...SHOPIFY_COLUMNS]);
  const col = (r: string[], c: string) => r[rows[0].indexOf(c)];
  const cat = rows.slice(1).filter((r) => col(r, "URL handle") === "neon-cat-hoodie");
  assert.equal(cat.length, 2);
  assert.equal(col(cat[0], "Title"), "Neon Cat Hoodie");
  assert.equal(col(cat[1], "Title"), ""); // variant rows leave product fields blank
  assert.deepEqual(cat.map((r) => col(r, "Option1 value")), ["Single", "3-pack"]);
  assert.ok(rows.slice(1).every((r) => r.length === SHOPIFY_COLUMNS.length && col(r, "Status") === "draft" && /^\d+\.\d\d$/.test(col(r, "Price"))));
  assert.ok(col(cat[0], "SEO title").length <= 70 && col(cat[0], "SEO description").length <= 320);
  assert.match(col(cat[0], "Description"), /&quot;neon&quot;/); // HTML-escaped
});

test("WooCommerce CSV: variable parent + variation rows pointing at the parent SKU", () => {
  const rows = parseCsv(wooCsv(kit, niche, priceProducts(kit, margin)));
  assert.deepEqual(rows[0].slice(0, WOO_COLUMNS.length), [...WOO_COLUMNS]);
  const col = (r: string[], c: string) => r[rows[0].indexOf(c)];
  const parent = rows[1], kids = rows.slice(2).filter((r) => col(r, "Parent") === col(parent, "SKU"));
  assert.equal(col(parent, "Type"), "variable");
  assert.equal(col(parent, "Attribute 1 value(s)"), "Single, 3-pack");
  assert.equal(kids.length, 2);
  assert.ok(kids.every((r) => col(r, "Type") === "variation" && col(r, "Regular price") !== ""));
});

test("Etsy SEO: title ≤140, at most 13 tags of ≤20 characters, no duplicates", () => {
  const p = kit.products[0];
  const s = seoFor(kit, niche, p, "etsy");
  assert.ok(s.title.length <= 140);
  const tags = tagsFor(niche, p);
  assert.ok(tags.length > 3 && tags.length <= 13 && tags.every((t) => t.length <= 20) && new Set(tags).size === tags.length);
  assert.equal(clip("one two three", 7), "one two");
});

test("checkDoc lists names a doc page no longer mentions", () => {
  assert.deepEqual(checkDoc("Title  URL handle ... option1 NAME", ["Title", "URL handle", "Option1 name", "SEO title"]), ["SEO title"]);
});

test("buildPackage: files per platform, EU policy draft with the professional note, 14 drafted days", () => {
  for (const pl of ["shopify", "woocommerce", "etsy"] as const) {
    const { pkg, files } = buildPackage(pl, niche, kit, { ...doc, url: DOCS[pl].url }, "2026-10-26T00:00:00Z");
    assert.deepEqual(Object.keys(files).sort(), [...pkg.files].sort());
    assert.equal(pkg.plan.length, 14);
    assert.match(files["policies.md"], /14 days/);
    assert.match(files["policies.md"], /check it with a professional/i);
    assert.match(files["launch-plan.md"], new RegExp(DOCS[pl].url.replace(/[.?/]/g, "\\$&")));
    assert.ok(pkg.images.length === kit.products.length + 1 && pkg.images.every((i) => i.prompt.length <= 1500));
  }
  const etsy = buildPackage("etsy", niche, kit, doc, "x").files["etsy-listings.md"];
  assert.match(etsy, /\*\*Tags\*\*/);
});
