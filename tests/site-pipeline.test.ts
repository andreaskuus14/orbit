import { test } from "node:test";
import assert from "node:assert/strict";
import { assetPath, attributionLine, creditsMd, cssContrast, licenseOk, lintSite, nextSiteStep, ownerSupplied, parseCommons, parseCredits, parseOpenverse, siteWriteLabel, sniffImage, unsafeSvg } from "../src/lib/site-pipeline-pure.ts";
import { fetchImage } from "../src/lib/site-images.ts";
import { progressLabel } from "../src/lib/long-work-pure.ts";
import { wsTainted } from "../src/lib/core-workspace.ts";
import { SITE_GUIDE, SITE_PIPELINE, guideDue } from "../src/lib/site-guide.ts";

test("licenseOk: whitelist CC0 / public domain / CC BY / CC BY-SA; refuses NC, ND and unknown", () => {
  assert.deepEqual(licenseOk("CC0"), { label: "CC0", attribution: false });
  assert.deepEqual(licenseOk("pdm"), { label: "Public domain", attribution: false });
  assert.deepEqual(licenseOk("Public domain"), { label: "Public domain", attribution: false });
  assert.deepEqual(licenseOk("CC BY-SA 4.0"), { label: "CC BY-SA 4.0", attribution: true });
  assert.deepEqual(licenseOk("by", "2.0"), { label: "CC BY 2.0", attribution: true });
  for (const bad of ["CC BY-NC 4.0", "by-nc-sa", "CC BY-ND 3.0", "All rights reserved", "GFDL", "", undefined]) assert.equal(licenseOk(bad), null, String(bad));
});

const commons = { query: { pages: {
  "1": { title: "File:Cafe.jpg", index: 2, imageinfo: [{ thumburl: "https://upload.wikimedia.org/a/Cafe.jpg", mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Cafe.jpg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a href='x'>Mari</a>" } } }] },
  "2": { title: "File:NC.jpg", index: 1, imageinfo: [{ url: "https://upload.wikimedia.org/b.jpg", mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC BY-NC 2.0" } } }] },
  "3": { title: "File:Elsewhere.jpg", index: 3, imageinfo: [{ url: "https://evil.example/c.jpg", mime: "image/jpeg", extmetadata: { LicenseShortName: { value: "CC0" } } }] },
} } };
test("parseCommons / parseOpenverse keep only licensed images from the API's own hosts", () => {
  const c = parseCommons(commons);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].title, c[0].author, c[0].license.label, c[0].via], ["Cafe", "Mari", "CC BY-SA 4.0", "Wikimedia Commons"]);
  const o = parseOpenverse({ results: [{ url: "https://x.org/a.png", title: "Sea", creator: "Ann", license: "by", license_version: "4.0", foreign_landing_url: "https://x.org/a" }, { url: "https://x.org/b.png", license: "by-nc" }, { url: "http://x.org/c.png", license: "cc0" }] });
  assert.deepEqual(o.map((x) => [x.title, x.license.label]), [["Sea", "CC BY 4.0"]]);
  assert.deepEqual(parseCommons(null), []); assert.deepEqual(parseOpenverse({}), []);
});

test("sniffImage by magic bytes; unsafe SVG; owner-supplied URLs; asset paths", () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])), "png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(sniffImage(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="x"></svg>')), "svg");
  assert.equal(sniffImage(new TextEncoder().encode("<html>")), null);
  assert.ok(unsafeSvg('<svg><script>x</script></svg>') && unsafeSvg('<svg onload="x">') && unsafeSvg('<svg><image href="https://x/y.png"/></svg>'));
  assert.ok(!unsafeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'));
  assert.ok(ownerSupplied("https://me.ee/p.jpg", "use https://me.ee/p.jpg as hero"));
  assert.ok(!ownerSupplied("https://me.ee/p.jpg", "use a cafe photo"));
  assert.equal(assetPath("Hero: café interior!", "webp"), "assets/hero-cafe-interior.webp");
});

test("CREDITS.md round-trips, last write of a path wins, footer line only for attribution licenses", () => {
  const a = { path: "assets/a.webp", title: "Cafe", author: "Mari", license: "CC BY-SA 4.0", attribution: true, source: "https://c/x", via: "Wikimedia Commons" };
  const b = { path: "assets/b.webp", title: "Sea", author: "Ann", license: "CC0", attribution: false, source: "https://o/y", via: "Openverse" };
  const md = creditsMd(creditsMd([], a) ? parseCredits(creditsMd([], a)) : [], b);
  assert.deepEqual(parseCredits(md), [a, b]);
  assert.deepEqual(parseCredits(creditsMd(parseCredits(md), { ...a, author: "Jaan" })).map((c) => c.author), ["Ann", "Jaan"]);
  assert.equal(attributionLine(parseCredits(md)), "Images: “Cafe” by Mari (CC BY-SA 4.0, Wikimedia Commons).");
  assert.equal(attributionLine([b]), "");
});

const GOOD_CSS = ":root{--ink:#111;--paper:#fff;--body:system-ui,sans-serif} html,body{overflow-x:clip} body{color:var(--ink);background:var(--paper);font-family:var(--body)} a:focus-visible{outline:2px solid var(--ink)} ::selection{background:var(--ink);color:var(--paper)} .btn{transition:transform .2s,opacity .2s}";
test("lint: contrast from CSS (vars resolved), alt, viewport, lang, external fonts, image budget, missing credit", () => {
  assert.deepEqual(cssContrast(":root{--fg:#777;--bg:#fff} .a{color:var(--fg);background:var(--bg)} .b{color:#000;background-color:white}").length, 1);
  assert.match(cssContrast(".x{color:#aaa;background:#fff}")[0], /low contrast 2\.\d+:1 in "\.x"/);
  const credits = creditsMd([], { path: "assets/a.webp", title: "Cafe", author: "Mari", license: "CC BY 4.0", attribution: true, source: "s", via: "Openverse" });
  const bad = lintSite({ html: [{ path: "index.html", text: '<html><head><link href="https://fonts.googleapis.com/x" rel="stylesheet"></head><img src="a.png"><img alt="" src="b.png"></html>' }], css: [], images: [{ path: "assets/a.webp", bytes: 900 * 1024 }], credits });
  for (const re of [/viewport/, /no lang/, /1 <img> without alt/, /external font\/CDN/, /900 KB/, /missing the required image credit/]) assert.ok(bad.some((i) => re.test(i)), String(re));
  const good = lintSite({ html: [{ path: "index.html", text: '<html lang="en"><meta name="viewport" content="width=device-width"><img alt="Cafe" src="assets/a.webp"><footer>“Cafe” by Mari</footer></html>' }], css: [{ path: "css/style.css", text: GOOD_CSS }], images: [{ path: "assets/a.webp", bytes: 100 }], credits });
  assert.deepEqual(good, []);
});

test("step plan: plan → layout → pages → images → check; progress labels", () => {
  assert.equal(nextSiteStep([]), "plan");
  assert.equal(nextSiteStep(["plan.md"]), "layout");
  assert.equal(nextSiteStep(["plan.md", "css/style.css"]), "pages");
  assert.equal(nextSiteStep(["plan.md", "css/style.css", "index.html", "assets/CREDITS.md"]), "images");
  assert.equal(nextSiteStep(["plan.md", "css/style.css", "index.html", "assets/a.webp"]), "check");
  assert.equal(nextSiteStep(["plan.md"], "Type: fullstack\n## Data model"), "server");
  assert.equal(nextSiteStep(["plan.md", "server.mjs"], "type: Fullstack"), "layout");
  assert.equal(nextSiteStep(["plan.md"], "Type: static"), "layout");
  assert.equal(siteWriteLabel([{ path: "plan.md" }]), "Writing the site plan…");
  assert.equal(progressLabel("ws_write", { files: [{ path: "css/style.css" }] }), "Writing layout and styles…");
  assert.equal(progressLabel("ws_write", { files: [{ path: "a.js" }] }), "Writing 1 file…");
  assert.equal(progressLabel("ws_fetch_image", {}), "Finding a licensed image…");
});

test("site pipeline research doesn't block the owner's explicit build; still blocks otherwise", () => {
  const s = (t: string) => `You called ${t} {}\nRESULT:\nx`;
  assert.equal(wsTainted([s("web_search"), s("fetch_url"), s("ws_fetch_image")], "build me a cafe website"), false);
  assert.equal(wsTainted([s("fetch_url")], "yes"), true);
  assert.equal(wsTainted([s("fetch_url")], "how do I build a site?"), true);
  assert.equal(wsTainted([s("ws_read")], "build me a cafe website"), true);
  assert.equal(wsTainted([s("life_journal")], "build me a cafe website"), true);
});

// ---- fetchImage with the network mocked
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
function io(routes: Record<string, () => Response>) {
  const files = new Map<string, string | Uint8Array>(), calls: string[] = [];
  return { files, calls, io: {
    fetch: async (u: string) => { calls.push(u); const k = Object.keys(routes).find((r) => u.startsWith(r)); return k ? routes[k]() : new Response("nf", { status: 404 }); },
    read: async (p: string) => (typeof files.get(p) === "string" ? files.get(p) as string : null),
    write: async (p: string, d: string | Uint8Array) => { files.set(p, d); return { path: p, bytes: typeof d === "string" ? d.length : d.length }; },
    resize: async () => null,
  } };
}
test("fetchImage: Commons hit is downloaded into assets/, credited, footer line returned; no hotlink", async () => {
  const m = io({ "https://commons.wikimedia.org/": () => Response.json(commons), "https://upload.wikimedia.org/a/Cafe.jpg": () => new Response(JPG) });
  const out = await fetchImage({ workspace: "cafe", query: "cafe interior", purpose: "hero" }, "build a cafe site", m.io);
  assert.match(out, /saved assets\/hero\.jpg/);
  assert.match(out, /put this line in the site footer: Images: “Cafe” by Mari/);
  assert.deepEqual([...(m.files.get("assets/hero.jpg") as Uint8Array)], [...JPG]);
  assert.match(String(m.files.get("assets/CREDITS.md")), /`assets\/hero\.jpg` — Cafe by Mari \(CC BY-SA 4\.0\)/);
  assert.ok(!m.calls.some((u) => u.includes("evil.example")));
});
test("fetchImage: falls back to Openverse; refuses oversize, non-images and unsupplied URLs; SVG fallback hint", async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 10); big.set(JPG);
  const m = io({ "https://commons.wikimedia.org/": () => Response.json({}), "https://api.openverse.org/": () => Response.json({ results: [
    { url: "https://o.org/big.jpg", title: "Big", license: "cc0" }, { url: "https://o.org/page.png", title: "Html", license: "cc0" }, { url: "https://o.org/ok.png", title: "Ok", creator: "Ann", license: "cc0" }] }),
    "https://o.org/big.jpg": () => new Response(big), "https://o.org/page.png": () => new Response("<html>"), "https://o.org/ok.png": () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])) });
  const out = await fetchImage({ workspace: "w", query: "sea", purpose: "" }, "q", m.io);
  assert.match(out, /saved assets\/sea\.png .*CC0, Openverse/);
  assert.doesNotMatch(out, /footer/);
  assert.match(await fetchImage({ workspace: "w", url: "https://random.site/x.jpg" }, "build a site", m.io), /only when the user gave that exact link/);
  assert.match(await fetchImage({ workspace: "w", query: "nothing" }, "q", io({}).io), /No licensed image found.*inline SVG/);
});

test("guideDue: the guide reaches a one-shot build that skipped plan.md, as well as the planned path, once", () => {
  assert.equal(guideDue(["index.html", "css/style.css"], ["css/style.css", "index.html"]), true); // one command, no plan: the live-PC case
  assert.equal(guideDue(["plan.md"], ["plan.md"]), true); // planned path: right after the plan
  assert.equal(guideDue(["plan.md", "css/style.css"], ["css/style.css"]), false); // planned, already building
  assert.equal(guideDue(["plan.md", "css/style.css", "index.html"], ["plan.md"]), false); // plan added late: already shown with the unplanned write
  assert.equal(guideDue(["index.html", "css/style.css"], ["index.html"]), false); // fix round of an unplanned site: not again
  assert.equal(guideDue(["index.html", "css/style.css", "about.html"], ["about.html"]), false); // new page, still not again
  assert.equal(guideDue(["notes.md"], ["notes.md"]), false); // not a site
  assert.match(SITE_GUIDE, /Subject conventions/); assert.match(SITE_GUIDE, /Looks to avoid/);
  assert.match(SITE_PIPELINE, /every new site, even a one-page one/);
});

const OWNER = "plan.md\nReviews the owner gave: \"Best rye in town\" (Mari); \"Great\" (5 stars); \"Lovely staff\" – Jaan";

test("craft lint: invented proof, AI-look tells and CSS discipline are flagged; owner proof and slots pass", () => {
  const page = (body: string, css = GOOD_CSS, owner = OWNER) => lintSite({ html: [{ path: "index.html", text: `<html lang="en"><meta name="viewport" content="width=device-width"><body>${body}</body></html>` }], css: [{ path: "css/style.css", text: css }], images: [], owner });
  assert.deepEqual(page("<h1>Fresh bread daily</h1><blockquote data-proof=\"owner\">Best rye in town</blockquote><div data-slot=\"proof\">Owner to add a review</div>"), []);
  for (const [body, re] of [
    ["<blockquote>Amazing! – Jane D.</blockquote>", /never invent reviews/], ['<div class="testimonials"><p>5 stars</p></div>', /never invent reviews/], ["<p>★★★★★</p>", /never invent/],
    ['<p class="eyebrow">Since 1999</p><h2>Us</h2>', /eyebrow/], ["<span>01</span><h2>Menu</h2>", /section numbers/], ["<h2>🍞 Bread</h2>", /emoji/],
    ['<section class="reveal">a</section><section class="reveal">b</section>', /2 reveal-on-scroll/],
  ] as const) assert.ok(page(body).some((i) => re.test(i)), String(re));
  for (const [css, re] of [
    [GOOD_CSS + " .a{color:#333}", /literal colour/], [GOOD_CSS + " .a{font-family:Georgia,serif}", /font stack directly/], [GOOD_CSS + " .a{transition:all .3s}", /transition: all/],
    [GOOD_CSS + " .a{transition:width .3s}", /width\/height\/top\/left/], [GOOD_CSS + " @keyframes g{from{left:0}to{left:9px}}", /width\/height\/top\/left/],
    [GOOD_CSS.replace("html,body{overflow-x:clip}", ""), /overflow-x: clip/], [GOOD_CSS.replace("a:focus-visible", "a:focus"), /:focus-visible/], [GOOD_CSS.replace("::selection", "::marker"), /::selection/],
    [GOOD_CSS + " h1{background-clip:text;-webkit-text-fill-color:transparent}", /gradient text/], [GOOD_CSS + " .k{text-transform:uppercase;letter-spacing:.12em}", /tracked-caps/],
    [GOOD_CSS + " .reveal{opacity:0}", /visible by default/],
  ] as const) assert.ok(page("<h1>Hi</h1>", css).some((i) => re.test(i)), String(re));
  assert.deepEqual(page("<h1>Hi</h1>", GOOD_CSS + " .js .reveal{opacity:0} .reveal.in{opacity:1}"), [], "hidden only under a script class is fine");
});

test("craft lint false positives: ©®™, table cells, owner stars, max/line-height, url(#id), owner-supplied long text", async () => {
  const { wordIssues } = await import("../src/lib/site-pipeline-pure.ts");
  const page = (body: string, css = GOOD_CSS, owner = OWNER) => lintSite({ html: [{ path: "index.html", text: `<html lang="en"><meta name="viewport" content="width=device-width"><body>${body}</body></html>` }], css: [{ path: "css/style.css", text: css }], images: [], owner });
  assert.deepEqual(page("<h1>Hi</h1><footer>© 2026 Cafe® Brew™</footer>"), [], "© ® ™ aren't emoji");
  assert.deepEqual(page("<h1>Hours</h1><table><tr><td>09</td><td>17</td></tr></table>"), [], "a table cell isn't a section number");
  assert.deepEqual(page('<h1>Hi</h1><blockquote data-proof="owner">★★★★★ Best rye in town</blockquote>'), [], "owner-marked stars pass");
  assert.deepEqual(page("<h1>Hi</h1>", GOOD_CSS + " .acc{transition:max-height .2s} p{transition:line-height .2s}"), [], "max-height/line-height aren't layout animation");
  assert.deepEqual(page("<h1>Hi</h1>", GOOD_CSS + " .m{mask:url(#fade)} .n{fill:url('#abc')}"), [], "url(#id) isn't a colour");
  const long = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
  assert.deepEqual(wordIssues({ html: [{ path: "menu.html", text: `<h1>Menu</h1><div data-owner>${long}</div>` }], css: [], images: [] }), [], "owner text is never asked to be cut");
  assert.match(wordIssues({ html: [{ path: "a.html", text: `<p>${long}</p>` }], css: [], images: [] }).join(), /your own copy; never cut text the owner gave/);
});

test("guide: no invented proof, word budget and one reveal moment replace the old lines", () => {
  assert.doesNotMatch(SITE_GUIDE, /reviews with names|2,500|reveal-on-scroll with IntersectionObserver|chapter numbers \(01/);
  for (const re of [/never invent reviews/, /80 visible words per screen/, /450 per page/, /7 words or fewer/, /one authored moment/, /SVG only for icons and diagrams/, /Shaders\/WebGL only for tech/]) assert.match(SITE_GUIDE, re);
});

test("owner proof comes from plan.md / his message, not the model's mark; times and dates aren't section numbers; owner headline", async () => {
  const { wordIssues } = await import("../src/lib/site-pipeline-pure.ts");
  const page = (body: string, owner = OWNER) => lintSite({ html: [{ path: "index.html", text: `<html lang="en"><meta name="viewport" content="width=device-width"><body>${body}</body></html>` }], css: [{ path: "css/style.css", text: GOOD_CSS }], images: [], owner });
  const fake = '<h1>Hi</h1><blockquote data-proof="owner">★★★★★ "Best cafe in Europe" – Jane D., Forbes</blockquote>';
  assert.ok(page(fake).some((i) => /isn't in the owner's own/.test(i)) && page(fake).some((i) => /never invent reviews/.test(i)), "a self-declared owner mark is caught");
  assert.ok(page(fake, "").some((i) => /isn't in the owner's own/.test(i)), "no owner source: nothing is trusted");
  assert.deepEqual(page('<h1>Hi</h1><section class="reviews"><h2>Guests say</h2><blockquote data-proof="owner">“Lovely staff” – Jaan</blockquote></section>'), [], "proven owner review in an unmarked wrapper");
  assert.deepEqual(page('<h1>Hi</h1><div data-proof="owner"><div>Best rye in town</div> ★★★★★</div>'), [], "nested same-name tag inside an owner block");
  assert.ok(page('<h1>Hi</h1><section class="reviews"><blockquote data-proof="owner">Lovely staff</blockquote><p>"Wow" – Kate</p></section>').some((i) => /never invent/.test(i)), "invented text beside it still flags");
  for (const h of ["<h3>09:00 Doors open</h3>", "<h3>07 May: concert</h3>", "<h2>05 mai kontsert</h2>"]) assert.deepEqual(page(`<h1>Hi</h1>${h}`), [], h);
  for (const h of ["<h2>01 About</h2>", "<h2>02. Menu</h2>", "<h2><span>03</span> Visit</h2>"]) assert.ok(page(`<h1>Hi</h1>${h}`).some((i) => /section numbers/.test(i)), h);
  assert.deepEqual(wordIssues({ html: [{ path: "index.html", text: "<h1 data-owner>Mari's bakery on the corner of Pikk street since 1999</h1>" }], css: [], images: [] }), [], "the owner's headline isn't capped");
  assert.match(wordIssues({ html: [{ path: "index.html", text: "<h1>The best bakery on the corner of Pikk street</h1>" }], css: [], images: [] }).join(), /hero headline has 9 words/);
});

test("Fable #551: owner proof is his own words, data-owner proves nothing, unclosed marks own nothing; home page floor; section numbers", async () => {
  const { lintDepth, rememberOwnerText, ownerText } = await import("../src/lib/site-pipeline-pure.ts");
  const page = (body: string, owner = OWNER) => lintSite({ html: [{ path: "index.html", text: `<html lang="en"><meta name="viewport" content="width=device-width"><body>${body}</body></html>` }], css: [{ path: "css/style.css", text: GOOD_CSS }], images: [], owner });
  const flagged = (body: string, owner = OWNER) => page(body, owner).some((i) => /isn't in the owner's own|never invent/.test(i));
  assert.ok(flagged('<h1>Hi</h1><div data-proof="owner">★★★★★</div>', ""), "stars only, no owner text");
  assert.ok(flagged('<h1>Hi</h1><blockquote data-proof="owner">★★★★★ Great</blockquote>', "build a great site for my cafe"), "one common word is not proof");
  assert.ok(flagged('<h1>Hi</h1><blockquote data-proof="owner">★★★★★ Best rye in town</blockquote>', 'Mari said: "Best rye in town"'), "stars he never gave");
  assert.ok(flagged('<h1>Hi</h1><section data-owner><blockquote>Best cafe in Europe – Jane D., Forbes</blockquote></section>'), "a quote inside data-owner is flagged again");
  assert.ok(flagged('<h1>Hi</h1><img data-owner src="a.jpg" alt=""><blockquote>Amazing – Jane D.</blockquote><p>★★★★★</p>'), "a void data-owner tag exempts nothing");
  assert.ok(flagged('<h1>Hi</h1><p data-owner>Our menu<blockquote>Amazing – Jane D.</blockquote>'), "an unclosed data-owner element exempts nothing");
  assert.deepEqual(page('<h1>Hi</h1><blockquote data-proof="owner"><p>Best rye in town</p><cite>Mari</cite></blockquote>', 'Mari said: "Best rye in town"'), [], "name and quote in another order than his message");
  rememberOwnerText("u1", 'Mari said: "Best rye in town"');
  assert.match(ownerText("u1"), /Best rye/); assert.equal(ownerText("u2"), "");
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const pic = '<img src="a.jpg" alt="">';
  const floor = (html: { path: string; text: string }[]) => lintDepth({ html, css: [], images: [] }).filter((i) => /words of text/.test(i));
  assert.match(floor([{ path: "about/index.html", text: `${pic}<p>${words(200)}</p>` }, { path: "index.html", text: `${pic}<h1>Hi</h1>` }]).join(), /^index\.html: only 1 words/, "the root index.html is the home page");
  assert.equal(floor([{ path: "index.html", text: `<html><head><title>${words(119)}</title></head><body>${pic}<h1>Hi</h1></body></html>` }]).length, 1, "<title> text doesn't count");
  for (const h of ["<h2>05 jaanuar kontsert</h2>", "<h2>07 days in Lisbon</h2>", "<h2>09 AM yoga</h2>"]) assert.ok(!page(`<h1>Hi</h1>${h}`).some((i) => /section numbers/.test(i)), h);
});
