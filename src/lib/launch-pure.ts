// BUSINESS store launch package (roadmap B5): a kept niche + its shop-in-a-box kit → import files for the platform the owner picks
// (Shopify CSV, WooCommerce CSV, or Etsy listing text per field), variants priced from the niche's margin math, SEO, image prompts,
// EU/Estonia shipping + returns drafts, a launch checklist and a 14-day plan of drafted posts. Pure; tested in tests/launch.test.ts.
// IO: launch.ts. Nothing here uploads, posts or generates: the owner imports and publishes himself.
import { marginOf, type Kit, type Margin, type Niche, type Product } from "./niche-pure.ts";

export const PLATFORMS = ["shopify", "woocommerce", "etsy"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (v: unknown): v is Platform => PLATFORMS.includes(v as Platform);

/* Column/field names as read from each platform's own docs on 2026-10-26. launch.ts re-fetches DOCS (read-only) on every build
 * and reports any name the page no longer mentions. */
export const SHOPIFY_COLUMNS = ["Title", "URL handle", "Description", "Vendor", "Product category", "Type", "Tags", "Published on online store", "Status",
  "SKU", "Option1 name", "Option1 value", "Price", "Compare-at price", "Cost per item", "Charge tax", "Inventory tracker", "Inventory quantity",
  "Continue selling when out of stock", "Weight value (grams)", "Weight unit for display", "Requires shipping", "Fulfillment service", "Gift card",
  "SEO title", "SEO description"] as const;
export const WOO_COLUMNS = ["Type", "SKU", "Name", "Published", "Is featured?", "Visibility in catalog", "Short description", "Description",
  "Tax status", "In stock?", "Regular price", "Categories", "Tags", "Parent", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 default",
  "Attribute 1 visible", "Attribute 1 global"] as const;
// Yoast SEO's meta keys through Woo's documented "meta:" prefix; ignored when Yoast isn't installed. Not checked against Woo's docs.
const WOO_SEO = ["meta:_yoast_wpseo_title", "meta:_yoast_wpseo_metadesc"] as const;
// Etsy has no seller CSV import: these are the createDraftListing fields its listing tutorial names (the form asks for the same).
export const ETSY_FIELDS = ["title", "description", "price", "quantity", "who_made", "when_made", "taxonomy_id"] as const;

export const DOCS: Record<Platform, { url: string; names: readonly string[] }> = {
  shopify: { url: "https://help.shopify.com/en/manual/products/import-export/using-csv", names: SHOPIFY_COLUMNS },
  woocommerce: { url: "https://woocommerce.com/document/product-csv-importer-exporter/", names: WOO_COLUMNS },
  etsy: { url: "https://developer.etsy.com/documentation/tutorials/listings", names: ETSY_FIELDS },
};
export const LIMITS = { shopifySeoTitle: 70, shopifySeoDesc: 320, etsyTitle: 140, etsyTags: 13, etsyTag: 20, metaDesc: 160 };

export type DocCheck = { url: string; at: string; ok: boolean; missing: string[]; error?: string };
/** Which of the names a fetched doc page no longer mentions (case- and spacing-insensitive). */
export function checkDoc(text: string, names: readonly string[]): string[] {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  return names.filter((n) => !t.includes(n.toLowerCase().replace(/\s+/g, " ")));
}

/** RFC 4180: comma-separated, CRLF rows, quotes doubled, a field quoted when it holds a comma, quote or line break. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => { const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const money = (n: number) => n.toFixed(2);
const up99 = (n: number) => Math.max(0.99, Math.ceil(n) - 0.01); // 12.30 → 12.99
export const slug = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "product";
/** Cut at a word boundary to max characters, with no trailing punctuation. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1).replace(/\s+\S*$/, "");
  return (cut || t.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}
const firstSentence = (s: string) => (s.match(/^.+?[.!?](\s|$)/)?.[0] ?? s).trim();

/* ---- variants and prices from the niche's margin math ---- */
export const MIN_MARGIN = 0.2; // a price is raised until at least 20 % of it is left per order
export type Variant = { option: string; qty: number; price: number; profit: number; pct: number; raised: boolean };
export type PricedProduct = Product & { handle: string; sku: string; variants: Variant[] };

/** Per order: the niche's costs (cogs per unit, one shipping, one ad cost), the fee on the price. */
const profitAt = (m: Margin, price: number, qty: number) => marginOf({ ...m, price, cogs: m.cogs * qty });
/** The lowest .99 price that leaves MIN_MARGIN after costs, fees and ads. */
export const floorPrice = (m: Margin, qty = 1) => up99((m.cogs * qty + m.shipping + m.cac) / (1 - m.feePct - MIN_MARGIN));

/** Single (the kit's price, raised to the floor if it loses money) and a 3-pack at ~10 % off, kept only if it earns more per order. */
export function variantsFor(price: number, m: Margin): Variant[] {
  const v = (option: string, qty: number, wanted: number): Variant => {
    const p = Math.max(wanted, floorPrice(m, qty)), r = profitAt(m, p, qty);
    return { option, qty, price: p, profit: r.unit, pct: r.pct, raised: p > wanted };
  };
  const one = v("Single", 1, price);
  const pack = v("3-pack", 3, up99(one.price * 3 * 0.9));
  return pack.profit > one.profit ? [one, pack] : [one];
}

export function priceProducts(k: Kit, m: Margin): PricedProduct[] {
  const seen = new Set<string>();
  return k.products.map((p, i) => {
    let handle = slug(p.name);
    while (seen.has(handle)) handle += `-${i + 1}`;
    seen.add(handle);
    const sku = `${slug(k.brand).slice(0, 8).toUpperCase().replace(/-/g, "")}-${i + 1}`;
    const variants = variantsFor(p.price, m);
    return { ...p, handle, sku, variants };
  });
}

/* ---- SEO ---- */
export type Seo = { title: string; description: string; tags: string[] };
/** Up to 13 Etsy-style tags (≤20 chars each), from the niche and product words. */
export function tagsFor(n: Pick<Niche, "title" | "product" | "audience">, p: Product): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
    if (t.length >= 3 && t.length <= LIMITS.etsyTag && !out.includes(t)) out.push(t);
  };
  const phrases = [p.name, n.title, n.product, n.audience, ...p.bullets].flatMap((s) => s.split(/[,;/()·|]| for | and | with /i));
  for (const ph of phrases) add(ph);
  for (const w of phrases.join(" ").split(/\s+/)) if (w.length >= 4) add(w);
  return out.slice(0, LIMITS.etsyTags);
}
export function seoFor(k: Kit, n: Pick<Niche, "title" | "product" | "audience">, p: Product, platform: Platform): Seo {
  const tags = tagsFor(n, p);
  if (platform === "etsy") {
    const title = clip([p.name, p.bullets[0], n.audience && `gift for ${n.audience}`].filter(Boolean).join(" – "), LIMITS.etsyTitle);
    return { title, description: clip(firstSentence(p.description), LIMITS.metaDesc), tags };
  }
  const title = clip(`${p.name} | ${k.brand}`.length <= LIMITS.shopifySeoTitle ? `${p.name} | ${k.brand}` : p.name, LIMITS.shopifySeoTitle);
  const max = platform === "shopify" ? LIMITS.shopifySeoDesc : LIMITS.metaDesc;
  return { title, description: clip(`${p.description} ${p.bullets.join(". ")}`, max), tags };
}

const isDigital = (m: Margin) => m.shipping === 0;
const html = (p: Product) => `<p>${esc(p.description)}</p>${p.bullets.length ? `<ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ---- CSV builders ---- */
/** Shopify product CSV (new format): one row per variant sharing the URL handle; product fields only on the first row. Imports as draft. */
export function shopifyCsv(k: Kit, n: Pick<Niche, "title" | "product" | "audience" | "margin">, products: PricedProduct[]): string {
  const digital = isDigital(n.margin);
  const rows: (string | number)[][] = [[...SHOPIFY_COLUMNS]];
  for (const p of products) {
    const seo = seoFor(k, n, p, "shopify");
    p.variants.forEach((v, i) => {
      const first = i === 0;
      const r: Record<(typeof SHOPIFY_COLUMNS)[number], string | number> = {
        Title: first ? p.name : "", "URL handle": p.handle, Description: first ? html(p) : "", Vendor: first ? k.brand : "", "Product category": "",
        Type: first ? clip(n.product, 60) : "", Tags: first ? seo.tags.join(", ") : "", "Published on online store": "false", Status: "draft",
        SKU: `${p.sku}-${v.qty}`, "Option1 name": "Pack", "Option1 value": v.option, Price: money(v.price), "Compare-at price": "",
        "Cost per item": money(n.margin.cogs * v.qty), "Charge tax": "true", "Inventory tracker": "", "Inventory quantity": "",
        "Continue selling when out of stock": "deny", "Weight value (grams)": "", "Weight unit for display": "", "Requires shipping": digital ? "false" : "true",
        "Fulfillment service": "manual", "Gift card": "false", "SEO title": first ? seo.title : "", "SEO description": first ? seo.description : "",
      };
      rows.push(SHOPIFY_COLUMNS.map((c) => r[c]));
    });
  }
  return toCsv(rows);
}

/** WooCommerce product CSV: a "variable" parent with all Pack values, then one "variation" row per pack (Parent = the parent's SKU). Imports as draft. */
export function wooCsv(k: Kit, n: Pick<Niche, "title" | "product" | "audience" | "margin">, products: PricedProduct[]): string {
  const cols = [...WOO_COLUMNS, ...WOO_SEO];
  const rows: (string | number)[][] = [cols];
  const row = (r: Partial<Record<(typeof cols)[number], string | number>>) => rows.push(cols.map((c) => r[c] ?? ""));
  for (const p of products) {
    const seo = seoFor(k, n, p, "woocommerce");
    row({ Type: "variable", SKU: p.sku, Name: p.name, Published: -1, "Is featured?": 0, "Visibility in catalog": "visible", "Short description": firstSentence(p.description),
      Description: html(p), "Tax status": "taxable", "In stock?": 1, Categories: clip(n.title, 60), Tags: seo.tags.join(", "),
      "Attribute 1 name": "Pack", "Attribute 1 value(s)": p.variants.map((v) => v.option).join(", "), "Attribute 1 default": p.variants[0].option,
      "Attribute 1 visible": 1, "Attribute 1 global": 0, "meta:_yoast_wpseo_title": seo.title, "meta:_yoast_wpseo_metadesc": seo.description });
    for (const v of p.variants) row({ Type: "variation", SKU: `${p.sku}-${v.qty}`, Name: `${p.name} - ${v.option}`, Published: 1, "Tax status": "taxable", "In stock?": 1,
      "Regular price": money(v.price), Parent: p.sku, "Attribute 1 name": "Pack", "Attribute 1 value(s)": v.option, "Attribute 1 visible": 1, "Attribute 1 global": 0 });
  }
  return toCsv(rows);
}

/** Etsy: no CSV import for sellers, so one block per listing with each form field ready to paste. */
export function etsyListings(k: Kit, n: Pick<Niche, "title" | "product" | "audience" | "margin">, products: PricedProduct[]): string {
  const digital = isDigital(n.margin);
  return [`# ${k.brand}: Etsy listings`, "", "Paste each field into Etsy's listing form (Shop Manager → Listings → Add a listing). Save as draft; publish yourself.", "",
    ...products.flatMap((p) => {
      const seo = seoFor(k, n, p, "etsy");
      return [`## ${p.name}`, "", `**Title** (${seo.title.length}/${LIMITS.etsyTitle})`, "", seo.title, "",
        "**Description**", "", p.description, "", ...p.bullets.map((b) => `- ${b}`), "",
        `**Tags** (${seo.tags.length}/${LIMITS.etsyTags}, each ≤${LIMITS.etsyTag} characters)`, "", seo.tags.join(", "), "",
        `**Type**: ${digital ? "Digital (download)" : "Physical"} · **Who made it**: I did (or "Another company or person" if a print partner makes it) · **What is it**: A finished product · **When was it made**: Made to order`, "",
        `**Variations**: Pack: ${p.variants.map((v) => `${v.option} €${money(v.price)}`).join(" · ")}`, "",
        `**Price**: €${money(p.variants[0].price)} · **Quantity**: ${digital ? "999" : "set to what your supplier can deliver"} · **SKU**: ${p.sku}`, "",
        "**Category**: pick the closest one in Etsy's category search (it sets taxonomy_id).", ""];
    })].join("\n");
}

/* ---- image prompts (text only; a Higgsfield quote needs the owner's click and the AI Story Approve) ---- */
export type ImagePrompt = { label: string; prompt: string; aspect: "1:1" | "4:5" | "16:9" };
export function imagePrompts(k: Kit, products: Product[]): ImagePrompt[] {
  const rule = "No text, no logos, no brand marks, no people's faces.";
  return [
    ...products.map((p) => ({ label: p.name, aspect: "1:1" as const,
      prompt: clip(`Product photo of ${p.name}: ${firstSentence(p.description)} Centered on a clean light background, soft daylight, sharp detail, e-commerce style. ${rule}`, 1400) })),
    { label: `${k.brand} banner`, aspect: "16:9" as const,
      prompt: clip(`Wide shop banner for "${k.brand}", ${k.tagline || k.headline}. Lifestyle scene showing ${products.map((p) => p.name).slice(0, 3).join(", ")}, warm natural light, room on the left for a headline. ${rule}`, 1400) },
  ];
}

/* ---- EU / Estonia policies (drafts) ---- */
export const PRO_NOTE = "Draft written by ORBIT, not legal advice. Check it with a professional (e.g. an Estonian lawyer or accountant) before you publish.";
export function policies(k: Kit, m: Margin): string {
  const digital = isDigital(m);
  const B = "[YOUR BUSINESS NAME]", A = "[ADDRESS]", E = "[EMAIL]", R = "[REGISTRY CODE]";
  return [`# ${k.brand}: shipping and returns (draft)`, "", `> ${PRO_NOTE}`, "",
    `Seller: ${B}, ${A}, registry code ${R}, ${E}. Fill in every [BRACKET] before publishing.`, "",
    "## Shipping", "",
    digital
      ? "Digital products are delivered by email/download link right after payment. Nothing is shipped."
      : ["- We ship to [COUNTRIES]. Orders are made to order and leave us within [X] working days; delivery takes [Y] working days.",
        "- Shipping costs are shown at checkout before you pay.",
        "- We deliver within 30 days of your order at the latest, unless we agree otherwise. If we can't, you may cancel and get a full refund.",
        "- The risk of loss passes to you when you (or someone you name) receive the parcel."].join("\n"),
    "", "## Your right to cancel (14 days)", "",
    digital
      ? "You may cancel within 14 days of purchase. If you ask us to deliver the download immediately and confirm at checkout that you then lose this right, the right to cancel ends once the download starts (EU Directive 2011/83/EU, Art. 16(m))."
      : ["- You may cancel within 14 days of receiving the goods, without giving a reason (EU Directive 2011/83/EU; Estonian Law of Obligations Act).",
        `- Tell us by email to ${E} or with the model withdrawal form below. Send the goods back within 14 days of telling us.`,
        "- We refund all payments, including the standard delivery cost, within 14 days of your notice. We may wait until we receive the goods or proof you sent them. We refund with the same payment method.",
        "- You pay the direct cost of returning the goods.",
        "- Items made to your personal specification (e.g. a custom name or your own design) can't be returned unless faulty."].join("\n"),
    "", "## Faulty or not as described", "",
    "You have a 2-year legal guarantee: if an item is faulty or not as described, contact us and we will repair, replace or refund it. A fault that shows within 1 year of delivery is presumed to have existed at delivery. This doesn't affect your other legal rights.",
    "", "## Complaints", "",
    `Write to ${E}; we answer within 15 days. If we can't agree, you can turn to the Estonian Consumer Disputes Committee (Tarbijavaidluste komisjon) at the Consumer Protection and Technical Regulatory Authority (ttja.ee).`,
    "", "## Model withdrawal form", "",
    `To ${B}, ${A}, ${E}:`, "I hereby give notice that I withdraw from my contract for the sale of the following goods: [ ]", "Ordered on [ ] / received on [ ]",
    "Name: [ ] · Address: [ ] · Date: [ ] · Signature (only on paper): [ ]", ""].join("\n");
}

/* ---- launch checklist + 14-day plan ---- */
const PLATFORM_STEPS: Record<Platform, string[]> = {
  shopify: ["Open Settings → Payments and Settings → Taxes (EU VAT; register for OSS if you sell over €10,000/year to other EU countries)",
    "Products → Import → upload products.csv; it imports every product as draft (nothing goes live)",
    "Add photos to each product (see image prompts), check prices and the Pack variants",
    "Settings → Shipping and delivery: one EU zone with your real rates", "Settings → Policies: paste policies.md (filled in)"],
  woocommerce: ["Install WooCommerce on your WordPress host; set currency EUR and tax (EU VAT)", "Products → Import → upload products.csv (map columns: they match by name); every product imports as draft",
    "For digital products tick Virtual/Downloadable and attach the file", "Add photos to each product (see image prompts)",
    "WooCommerce → Settings → Shipping: one EU zone", "Create Shipping & Returns and Terms pages from policies.md (filled in)"],
  etsy: ["Open your Etsy shop (Shop Manager) and set shop currency EUR", "Settings → Shipping settings: create a shipping profile; Return & exchange policy: 14 days",
    "Create each listing from etsy-listings.md, upload photos (see image prompts), save as draft",
    "Add the policies.md text to your shop's policies section (filled in)"],
};
export function checklist(platform: Platform, k: Kit): string[] {
  return ["Register the business you'll sell as (Estonian FIE / OÜ, or e-Business Register; check with an accountant)", ...PLATFORM_STEPS[platform],
    "Place one test order and refund it", ...k.checklist.filter((c) => !/platform|import|test order/i.test(c)).slice(0, 4),
    "Publish the shop yourself (ORBIT never publishes)", "Start the 14-day plan; cap ad spend per day before running any ad"];
}

export type PlanDay = { day: number; goal: string; channel: string; post: string };
/** 14 days of drafted posts for his own channels, from the kit's hooks and products. Never posted by ORBIT. */
export function launchPlan(k: Kit, products: PricedProduct[]): PlanDay[] {
  const p = (i: number) => products[i % products.length];
  const hook = (i: number) => k.hooks[i % k.hooks.length];
  const price = (i: number) => `€${money(p(i).variants[0].price)}`;
  const days: [string, string, string][] = [
    ["Tease", "YouTube Shorts + TikTok", `${hook(0)} Something new is coming from me this week. Guess what it is in the comments.`],
    ["Behind the scenes", "YouTube community post", `I've been building ${k.brand}: ${k.tagline || k.sub}. Here's why I started it.`],
    ["Launch", "YouTube Shorts + TikTok + Instagram Reels", `${hook(1)} ${k.brand} is open: ${p(0).name}, ${price(0)}. Link in bio.`],
    ["Product spotlight", "Instagram Reels", `${p(0).name}: ${p(0).bullets[0] ?? firstSentence(p(0).description)} ${price(0)}.`],
    ["How it's made", "TikTok", `How ${p(1).name} gets made, from design to your door.`],
    ["Answer a question", "YouTube Shorts", `You asked: "${k.faq[0]?.q ?? "how does shipping work?"}" ${k.faq[0]?.a ?? ""}`],
    ["Week 1 recap", "YouTube community post", `First week of ${k.brand}: what sold, what I learned, what's next. (Write real numbers only.)`],
    ["Hook test", "YouTube Shorts + TikTok", `${hook(2)} ${p(1).name}, ${price(1)}.`],
    ["Product spotlight", "Instagram Reels", `${p(2).name}: ${firstSentence(p(2).description)}`],
    ["Bundle", "TikTok", `${p(0).name} ${p(0).variants[1] ? `3-pack: €${money(p(0).variants[1].price)} instead of €${money(p(0).variants[0].price * 3)}` : `for ${price(0)}`}.`],
    ["Creator angle", "YouTube Shorts", `Why a Roblox dev/YouTuber opened a shop: ${k.sections[0]?.title ?? k.headline}.`],
    ["Answer a question", "Instagram Stories", `Q: ${k.faq[1]?.q ?? "returns?"} A: ${k.faq[1]?.a ?? "14 days, no questions asked."}`],
    ["Best hook again", "YouTube Shorts + TikTok", `Re-cut the best-performing hook from days 1–8 with a new first frame.`],
    ["Two-week recap", "YouTube community post", `Two weeks of ${k.brand}. Thank you. What should I make next? (Real numbers only.)`],
  ];
  return days.map(([goal, channel, post], i) => ({ day: i + 1, goal, channel, post: clip(post, 500) }));
}

/* ---- the whole package ---- */
export type LaunchPackage = {
  platform: Platform; at: string; brand: string; products: (PricedProduct & { seo: Seo })[]; images: ImagePrompt[];
  checklist: string[]; plan: PlanDay[]; doc: DocCheck; files: string[];
};
export const FILES: Record<Platform, string[]> = {
  shopify: ["products.csv", "policies.md", "launch-plan.md"],
  woocommerce: ["products.csv", "policies.md", "launch-plan.md"],
  etsy: ["etsy-listings.md", "policies.md", "launch-plan.md"],
};

export function buildPackage(platform: Platform, n: Niche, k: Kit, doc: DocCheck, at: string): { pkg: LaunchPackage; files: Record<string, string> } {
  const priced = priceProducts(k, n.margin);
  const products = priced.map((p) => ({ ...p, seo: seoFor(k, n, p, platform) }));
  const images = imagePrompts(k, k.products);
  const pkg: LaunchPackage = { platform, at, brand: k.brand, products, images, checklist: checklist(platform, k), plan: launchPlan(k, priced), doc, files: FILES[platform] };
  const main: Record<string, string> = platform === "etsy" ? { "etsy-listings.md": etsyListings(k, n, priced) } : { "products.csv": (platform === "shopify" ? shopifyCsv : wooCsv)(k, n, priced) };
  return { pkg, files: { ...main, "policies.md": policies(k, n.margin), "launch-plan.md": planMarkdown(pkg) } };
}

export function planMarkdown(p: LaunchPackage): string {
  const d = p.doc;
  return [`# ${p.brand}: ${p.platform} launch plan`, "",
    `Import format checked against ${d.url} on ${d.at.slice(0, 10)}: ${d.error ? `couldn't fetch it (${d.error}); columns are as read on 2026-10-26` : d.ok ? "every column/field name is still on the page" : `not found on the page now: ${d.missing.join(", ")}`}.`, "",
    "## Prices (from the niche's margin math)", "",
    ...p.products.flatMap((x) => x.variants.map((v) => `- ${x.name}, ${v.option}: €${money(v.price)} → €${money(v.profit)} profit per order (${v.pct}%)${v.raised ? " · raised to keep a 20 % margin" : ""}`)), "",
    "## SEO", "", ...p.products.flatMap((x) => [`### ${x.name}`, "", `- Title: ${x.seo.title}`, `- Description: ${x.seo.description}`, `- Tags: ${x.seo.tags.join(", ")}`, ""]),
    "## Image prompts", "", "Paste into your image tool, or click Get Higgsfield quote in ORBIT (it only asks the price; you approve in STUDIO → AI Story).", "",
    ...p.images.map((i) => `- **${i.label}** (${i.aspect}): ${i.prompt}`), "",
    "## Launch checklist", "", ...p.checklist.map((c) => `- [ ] ${c}`), "",
    "## 14-day plan (drafts: ORBIT never posts)", "", ...p.plan.map((x) => `- **Day ${x.day}: ${x.goal}** (${x.channel}): ${x.post}`), "",
    `> ${PRO_NOTE}`, ""].join("\n");
}
