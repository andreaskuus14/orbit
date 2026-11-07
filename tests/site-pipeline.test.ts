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

test("lint: contrast from CSS (vars resolved), alt, viewport, lang, external fonts, image budget, missing credit", () => {
  assert.deepEqual(cssContrast(":root{--fg:#777;--bg:#fff} .a{color:var(--fg);background:var(--bg)} .b{color:#000;background-color:white}").length, 1);
  assert.match(cssContrast(".x{color:#aaa;background:#fff}")[0], /low contrast 2\.\d+:1 in "\.x"/);
  const credits = creditsMd([], { path: "assets/a.webp", title: "Cafe", author: "Mari", license: "CC BY 4.0", attribution: true, source: "s", via: "Openverse" });
  const bad = lintSite({ html: [{ path: "index.html", text: '<html><head><link href="https://fonts.googleapis.com/x" rel="stylesheet"></head><img src="a.png"><img alt="" src="b.png"></html>' }], css: [], images: [{ path: "assets/a.webp", bytes: 900 * 1024 }], credits });
  for (const re of [/viewport/, /no lang/, /1 <img> without alt/, /external font\/CDN/, /900 KB/, /missing the required image credit/]) assert.ok(bad.some((i) => re.test(i)), String(re));
  const good = lintSite({ html: [{ path: "index.html", text: '<html lang="en"><meta name="viewport" content="width=device-width"><img alt="Cafe" src="assets/a.webp"><footer>“Cafe” by Mari</footer></html>' }], css: [{ path: "css/style.css", text: "body{color:#111;background:#fff}" }], images: [{ path: "assets/a.webp", bytes: 100 }], credits });
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
  assert.equal(guideDue(["notes.md"], ["notes.md"]), false); // not a site
  assert.match(SITE_GUIDE, /Subject conventions/); assert.match(SITE_GUIDE, /Looks to avoid/);
  assert.match(SITE_PIPELINE, /every new site, even a one-page one/);
});
