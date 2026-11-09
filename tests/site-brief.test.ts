import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VALIDATE_JS, assetRefs, cropPosition, editCopy, focalInBox, heroPositions, parseBrief, renderSite, type Brief } from "../src/lib/site-brief-pure.ts";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/site-w02/${n}`, import.meta.url), "utf8"));
const ok = (input: unknown) => { const p = parseBrief(input); if ("errors" in p) throw new Error(p.errors.join("; ")); return p; };

test("sparse brief: defaults to hero + form, asks only for the missing essential", () => {
  const p = ok(fx("brief-sparse.json"));
  assert.deepEqual(p.missing, ["audience"]);
  assert.deepEqual(p.brief.sections.map((s) => [s.id, s.kind]), [["hero", "hero"], ["contact", "form"]]);
  assert.equal(p.brief.assets[0].id, "hero");
  assert.equal(p.brief.sections[0].image, "hero");
  assert.equal(p.brief.version, 1);
});

test("detailed brief: stable IDs, assets with focal points, nothing missing", () => {
  const p = ok(fx("brief-detailed.json"));
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.brief.sections.map((s) => s.id), ["hero", "built", "story", "specs", "faq", "waitlist"]);
  assert.deepEqual(p.brief.assets.map((a) => [a.id, a.safe]), [["hero", "left"], ["lantern", "left"]]);
  // parsing the saved site.json again gives the same brief (round trip)
  assert.deepEqual(ok(JSON.parse(renderSite(p.brief)["site.json"])).brief, p.brief);
});

test("derived section IDs are deterministic and unique", () => {
  const b = ok({ name: "X", offer: "Y", sections: [{ kind: "hero", heading: "H" }, { kind: "faq", heading: "A" }, { kind: "faq", heading: "B" }] }).brief;
  assert.deepEqual(b.sections.map((s) => s.id), ["hero", "faq", "faq-2"]);
});

test("validator lists every problem", () => {
  const p = parseBrief({ assets: [{ path: "../x.jpg" }, { path: "a/b.jpg", width: 10, height: 10, focal: { x: 2 } }],
    sections: [{ kind: "footer" }, { id: "s", kind: "features", heading: "F", image: "nope", cta: [{ label: "", href: "javascript:alert(1)" }] }] });
  assert.ok("errors" in p);
  const all = p.errors.join("\n");
  for (const want of ["name is required", "offer is required", "relative image", "alt text is required", "focal x and y", "kind must be one of", "not in assets", "needs a label", "must be #<section id>", "hero section is required"]) assert.match(all, new RegExp(want.replace(/[<>#]/g, ".")));
});

test("copy edit: text changes, assets/CSS/JS identical, version and history move", () => {
  const b = ok(fx("brief-detailed.json")).brief, before = renderSite(b);
  const e = editCopy(b, [{ section: "hero", field: "heading", value: "New <headline>" }, { section: "built", field: "items.1.body", value: "Sealed." }, { section: "waitlist", field: "cta.0.label", value: "Reserve" }, { field: "tagline", value: "No. 1" }]);
  assert.ok(!("error" in e));
  const after = renderSite(e.brief);
  assert.deepEqual(assetRefs(after["index.html"]), assetRefs(before["index.html"]));
  assert.ok(assetRefs(before["index.html"]).length === 2);
  assert.equal(after["css/style.css"], before["css/style.css"]);
  assert.equal(after["js/form.js"], before["js/form.js"]);
  assert.deepEqual(e.brief.assets, b.assets);
  assert.deepEqual(e.brief.sections.map((s) => [s.id, s.image, s.cta.map((c) => c.href)]), b.sections.map((s) => [s.id, s.image, s.cta.map((c) => c.href)]));
  assert.match(after["index.html"], /New &lt;headline&gt;/);
  assert.equal(e.brief.version, 2);
  assert.deepEqual(e.brief.history.at(-1), { version: 2, changed: ["hero.heading", "built.items.1.body", "waitlist.cta.0.label", "tagline"] });
  assert.equal(b.sections[0].heading, "A light that keeps its watch.", "the original brief is not mutated");
});

test("copy edit refuses non-copy fields (image, alt, href, id) and unknown sections", () => {
  const b = ok(fx("brief-detailed.json")).brief;
  for (const bad of [{ section: "hero", field: "image", value: "lantern" }, { section: "hero", field: "cta.0.href", value: "https://x.y" }, { section: "hero", field: "id", value: "x" }, { field: "assets.0.alt", value: "x" }, { section: "nope", field: "heading", value: "x" }, { section: "hero", field: "heading", value: "  " }])
    assert.ok("error" in editCopy(b, [bad]), JSON.stringify(bad));
});

test("hero crop: focal point lands on target in portrait and landscape crops, clamped at edges", () => {
  const sq = { width: 1600, height: 1600, focal: { x: 0.66, y: 0.48 } };
  for (const box of [9 / 16, 1 / 2]) { // portrait: horizontal crop (4:5 clamps for x=.66, covered below)
    const p = cropPosition(sq, box, { x: 0.5, y: 0.5 });
    assert.equal(p.y, 0.5);
    assert.ok(Math.abs(focalInBox(sq, box, p).x - 0.5) < 1e-9);
  }
  const land = cropPosition(sq, 16 / 9, { x: 0.72, y: 0.5 }); // landscape: vertical crop, x untouched
  assert.equal(land.x, 0.5);
  assert.ok(Math.abs(focalInBox(sq, 16 / 9, land).y - 0.5) < 1e-9);
  const wide = { width: 1600, height: 900, focal: { x: 0.98, y: 0.5 } }; // subject at the edge: clamps, stays in view
  const c = cropPosition(wide, 4 / 5);
  assert.equal(c.x, 1);
  assert.ok(focalInBox(wide, 4 / 5, c).x <= 1);
  const a = ok(fx("brief-detailed.json")).brief.assets[0], pos = heroPositions(a);
  assert.ok(focalInBox(a, 16 / 9, pos.lg).x > 0.6, "desktop subject clear of the left text column");
});

test("shipped form validator (exact js/form.js text)", () => {
  const v = new Function(`${VALIDATE_JS}; return validateLead;`)() as (x: Record<string, unknown>) => Record<string, string>;
  assert.deepEqual(Object.keys(v({})).sort(), ["consent", "email", "name"]);
  assert.deepEqual(v({ name: "Ann", email: "ann@example.com", consent: true }), {});
  for (const bad of ["ann", "ann@", "ann@example", "a b@example.com", "ann@example.c"]) assert.ok(v({ name: "Ann", email: bad, consent: true }).email, bad);
  assert.ok(v({ name: "x".repeat(81), email: "a@b.co", consent: true }).name);
  const b: Brief = ok(fx("brief-detailed.json")).brief;
  assert.ok(renderSite(b)["js/form.js"].startsWith(VALIDATE_JS));
});

test("three briefs, sparse → medium → detailed: all parse, render, and pass the static QA", async () => {
  const { altIssues, headingIssues, linkIssues } = await import("../src/lib/site-qa-pure.ts");
  const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/site-w02/${f}`, import.meta.url), "utf8"));
  const sizes: number[] = [];
  for (const f of ["brief-sparse.json", "brief-medium.json", "brief-detailed.json"]) {
    const p = parseBrief(fx(f));
    assert.ok("brief" in p, `${f}: ${"errors" in p ? p.errors.join("; ") : ""}`);
    const files = renderSite(p.brief), html = files["index.html"];
    assert.deepEqual([...headingIssues(html), ...altIssues(html)], [], f);
    const all = new Set([...Object.keys(files), ...p.brief.assets.map((a) => a.path)]);
    assert.deepEqual(linkIssues(html, "index.html", all), [], f);
    sizes.push(p.brief.sections.length);
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `more detail, more sections: ${sizes}`);
});

test("image swap: picture changes, copy doesn't, and undo puts the old picture back", async () => {
  const { swapImage, undoImage } = await import("../src/lib/site-brief-pure.ts");
  const fx = JSON.parse(readFileSync(new URL("./fixtures/site-w02/brief-detailed.json", import.meta.url), "utf8"));
  const p = parseBrief(fx); assert.ok("brief" in p);
  const b0 = p.brief, s = swapImage(b0, "hero", "lantern"); assert.ok("brief" in s);
  const b1 = s.brief;
  assert.equal(b1.sections.find((x) => x.id === "hero")!.image, "lantern");
  assert.equal(b1.version, b0.version + 1);
  assert.deepEqual(b1.sections.map((x) => [x.heading, x.body]), b0.sections.map((x) => [x.heading, x.body]), "copy untouched");
  const u = undoImage(b1); assert.ok("brief" in u);
  assert.equal(u.brief.sections.find((x) => x.id === "hero")!.image, "hero");
  assert.equal(u.brief.version, b0.version + 2);
  const page = (b: typeof b0) => renderSite({ ...b, version: 0 })["index.html"]; // the version stamp moves forward by design
  assert.equal(page(u.brief), page(b0), "the page is back to exactly how it was");
  assert.ok("error" in swapImage(b0, "hero", "missing"));
  assert.ok("error" in undoImage(u.brief), "nothing left to undo");
});

test("immersive style: same content and form, plus aurora canvas, its CSS/JS, and an accented headline; classic unchanged", async () => {
  const { accentHeading } = await import("../src/lib/site-immersive-pure.ts");
  const raw = fx("brief-detailed.json"), c = parseBrief(raw), i = parseBrief({ ...raw, style: "immersive" });
  assert.ok("brief" in c && "brief" in i);
  const fc = renderSite(c.brief), fi = renderSite(i.brief);
  assert.ok(!("css/immersive.css" in fc) && !fc["index.html"].includes("aurora"), "classic untouched");
  assert.ok(fi["css/immersive.css"] && fi["js/immersive.js"]);
  assert.match(fi["index.html"], /<body[^>]*class="immersive dir-cinematic"/);
  assert.match(fi["index.html"], /<canvas class="aurora" aria-hidden="true" data-a=/);
  assert.match(fi["js/immersive.js"], /prefers-reduced-motion/);
  assert.deepEqual(assetRefs(fi["index.html"]), assetRefs(fc["index.html"]), "same images, alt text and crops");
  assert.equal(accentHeading("A light that keeps its watch."), "A light that keeps its <em>watch</em>.");
  assert.equal(accentHeading("The handoffs run *themselves*."), "The handoffs run <em>themselves</em>.");
});

test("sequence section: frames validated, canvas + three still key frames + chapters rendered; bad patterns refused", async () => {
  const { framePath, keyFrames } = await import("../src/lib/site-immersive-pure.ts");
  const p = parseBrief(fx("brief-house.json")); assert.ok("brief" in p, "errors" in p ? p.errors.join("; ") : "");
  const html = renderSite(p.brief)["index.html"], files = renderSite(p.brief);
  assert.match(html, /<canvas class="seq-canvas" role="img" aria-label="A camera flies[^"]*" data-path="seq\/f%03d\.jpg" data-count="48"/);
  for (const k of keyFrames(48)) assert.ok(html.includes(`src="${framePath("seq/f%03d.jpg", k)}"`), `still ${k}`);
  assert.equal((html.match(/class="seq-ch"/g) ?? []).length, 3);
  assert.match(files["js/immersive.js"], /seq-live/);
  assert.deepEqual(keyFrames(48), [1, 24, 48]);
  const bad = fx("brief-house.json"); bad.sections[1].seq.path = "../f%03d.jpg"; bad.sections[1].seq.count = 1;
  const e = parseBrief(bad); assert.ok("errors" in e && e.errors.some((x) => x.includes("frame pattern")) && e.errors.some((x) => x.includes("2-240")));
});

test("design directions: each is its own look over the same content; editorial has no canvas; unknown style falls back to classic", async () => {
  const { DIRECTIONS } = await import("../src/lib/site-immersive-pure.ts");
  const raw = fx("brief-house.json"), pages: Record<string, string> = {};
  for (const style of Object.keys(DIRECTIONS)) {
    const p = parseBrief({ ...raw, style }); assert.ok("brief" in p);
    const html = renderSite(p.brief)["index.html"]; pages[style] = html;
    assert.match(html, new RegExp(`class="immersive dir-${style}"`));
    assert.equal(html.includes('class="aurora"'), DIRECTIONS[style as keyof typeof DIRECTIONS].effect !== "none", style);
  }
  const strip = (h: string) => h.replace(/ class="immersive dir-\w+"/, "").replace(/<canvas class="aurora"[^>]*><\/canvas>/, "");
  assert.equal(strip(pages.daylight), strip(pages.cinematic), "same content and structure; only the look changes");
  const css = renderSite((parseBrief({ ...raw, style: "daylight" }) as { brief: Brief }).brief)["css/immersive.css"];
  for (const k of Object.keys(DIRECTIONS)) assert.match(css, new RegExp(`body\\.immersive\\.dir-${k} \\{ --bg:`));
  const odd = parseBrief({ ...raw, style: "neon-unicorn" }); assert.ok("brief" in odd && !odd.brief.style);
});

test("art check (cinematic standard): stand-in art and a choppy or small sequence are flagged; a finished brief is clean", async () => {
  const { artIssues } = await import("../src/lib/site-brief-pure.ts");
  const house = parseBrief(fx("brief-house.json")); assert.ok("brief" in house);
  const a = artIssues(house.brief);
  assert.ok(a.some((x) => x.includes("48 frames")) && a.some((x) => x.includes("960px")), a.join("; "));
  const fine = fx("brief-house.json"); fine.sections[1].seq.count = 150; fine.sections[1].seq.width = 1920; fine.sections[1].seq.height = 1080;
  const f = parseBrief(fine); assert.ok("brief" in f); assert.deepEqual(artIssues(f.brief), []);
  const stand = fx("brief-detailed.json"); stand.assets[0].origin = "fixture SVG (stand-in)";
  const st = parseBrief(stand); assert.ok("brief" in st); assert.ok(artIssues(st.brief).some((x) => x.startsWith("hero: stand-in art")));
});
