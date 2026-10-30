import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastIssues, contrastRatio, effectiveBg, externalRefs, localRefs, minContrast, overflowsX, parseColor, staticIssues, summarize, type Probe } from "../src/lib/workspace-check-pure.ts";
import { checkNote } from "../src/lib/core-workspace.ts";
import { THUMB_BYTES, lumaOf, thumbProblems, thumbTextBox } from "../src/lib/clips/pure.ts";

test("localRefs resolves resource refs, skips links, URLs and data", () => {
  const html = `<link rel="stylesheet" href="css/style.css?v=2"><script src='./js/app.js'></script><img src=img/a.svg>
    <a href="about.html">x</a><img src="https://x.com/a.png"><img src="data:image/png;base64,AA"><script src="//cdn.x/y.js"></script>
    <!-- <img src="old.svg"> --><img src="/root.svg"><source src="../up.svg"><img src="my%20pic.svg#f">`;
  assert.deepEqual(localRefs(html).sort(), ["../up.svg", "/root.svg", "css/style.css", "img/a.svg", "js/app.js", "my pic.svg"].sort());
  assert.deepEqual(localRefs(`<img src="../a.svg"><img src="b.svg">`, "blog/post.html").sort(), ["a.svg", "blog/b.svg"]);
});

test("staticIssues: missing files, root paths, external loads, title, blank", () => {
  const files = new Set(["index.html", "style.css"]);
  const ok = `<html><head><title>Hi</title><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1></body></html>`;
  assert.deepEqual(staticIssues(ok, "index.html", files), []);
  const bad = `<html><head><link rel="stylesheet" href="main.css"><script src="https://cdn.x/lib.js"></script></head><body><img src="/logo.svg"></body></html>`;
  const issues = staticIssues(bad, "index.html", files);
  assert.ok(issues.some((i) => i.startsWith("missing file: main.css")));
  assert.ok(issues.some((i) => i.startsWith("root path /logo.svg")));
  assert.ok(issues.some((i) => i.includes("https://cdn.x/lib.js")));
  assert.ok(issues.includes("no <title>"));
  assert.ok(staticIssues(`<title>x</title><body>  </body>`, "index.html", files).includes("page is blank (no text or media)"));
  assert.deepEqual(externalRefs(`<a href="https://ok.com">`), []);
});

test("contrast math matches WCAG reference values", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), [1, 2, 3, 1]);
  assert.deepEqual(parseColor("rgba(1, 2, 3, 0.5)"), [1, 2, 3, 0.5]);
  assert.deepEqual(parseColor("rgb(1 2 3 / 50%)"), [1, 2, 3, 0.5]);
  assert.equal(parseColor("color(srgb 1 0 0)"), null);
  assert.equal(Math.round(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]) * 10) / 10, 21);
  assert.equal(Math.round(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1]) * 100) / 100, 4.48); // #777 on white: just fails AA
  assert.equal(contrastRatio([0, 0, 0, 0], [255, 255, 255, 1]), 1); // invisible text
  assert.equal(minContrast(16, false), 4.5);
  assert.equal(minContrast(24, false), 3);
  assert.equal(minContrast(19, true), 3);
});

test("effectiveBg stacks translucent layers over white and stops at the first opaque one", () => {
  assert.deepEqual(effectiveBg([]), [255, 255, 255, 1]);
  assert.deepEqual(effectiveBg(["rgba(0, 0, 0, 0)", "rgb(10, 20, 30)", "rgb(255, 0, 0)"]), [10, 20, 30, 1]);
  assert.deepEqual(effectiveBg(["rgba(0, 0, 0, 0.5)", "rgb(200, 200, 200)"]), [100, 100, 100, 1]);
  assert.deepEqual(effectiveBg(["rgba(0, 0, 0, 0.5)"]), [127.5, 127.5, 127.5, 1]);
});

test("contrastIssues flags only failing samples, worst first, and skips text on images", () => {
  const s = (fg: string, bg: string[] | null, text: string, px = 16) => ({ fg, bgLayers: bg, px, bold: false, text });
  const out = contrastIssues([s("rgb(0, 0, 0)", ["rgb(255, 255, 255)"], "fine"), s("rgb(119, 119, 119)", [], "grey"), s("rgb(200, 200, 200)", [], "pale"),
    s("rgb(255, 255, 255)", null, "on photo"), s("rgb(130, 130, 130)", [], "big", 30)]);
  assert.equal(out.length, 2);
  assert.ok(out[0].includes('"pale"') && out[1].includes('"grey"'));
});

test("overflow allows 1px rounding", () => {
  assert.equal(overflowsX(391, 390), false);
  assert.equal(overflowsX(392, 390), true);
});

const probe = (o: Partial<Probe> = {}): Probe => ({ vw: 1280, scrollWidth: 1280, textLen: 50, media: 1, badImgs: [], samples: [], ...o });
test("summarize builds the check line and issue list", () => {
  const clean = summarize({ statics: [], errors: [], missing: [], desktop: probe(), phone: probe({ vw: 390, scrollWidth: 390 }) });
  assert.equal(clean.line, "checked: ✓ loads, ✓ phone, ✓ desktop");
  assert.deepEqual(clean.issues, []);
  const bad = summarize({ statics: ["missing file: app.js (referenced by index.html)"], errors: ["uncaught x is not defined"], missing: ["app.js"],
    desktop: probe(), phone: probe({ vw: 390, scrollWidth: 600, samples: [{ fg: "rgb(200, 200, 200)", bgLayers: [], px: 16, bold: false, text: "pale" }] }) });
  assert.equal(bad.line, "checked: ✗ 2 load problems, ✗ phone overflow, ✓ desktop, ✗ 1 contrast warning");
  assert.equal(bad.issues.filter((i) => i.includes("app.js")).length, 1, "static + 404 for the same file count once");
  const stat = summarize({ statics: ["no <title>"], errors: [], missing: [] });
  assert.equal(stat.line, "checked: ✓ loads, ✗ no title, (static check only: no headless browser)");
  assert.ok(summarize({ statics: [], errors: [], missing: [], desktop: probe({ textLen: 0, media: 0 }) }).line.includes("✗ 1 load problem"));
});

test("checkNote asks for fixes for 2 rounds, then gives the link", () => {
  const r = { line: "checked: ✗ 1 load problem", issues: ["error: boom"] };
  assert.match(checkNote(r, 0), /fix round 1 of 3/);
  assert.match(checkNote(r, 2), /fix round 3 of 3/);
  assert.match(checkNote(r, 3), /No fix rounds left/);
  assert.match(checkNote({ line: "checked: ✓ loads", issues: [] }, 0), /Give the user the preview link/);
});

test("thumbnail checks: dimensions, safe area, luminance, size", () => {
  const good = { width: 1080, height: 1920, bytes: 200_000, luma: 90 };
  assert.deepEqual(thumbProblems(good, "an ordinary clip title"), []);
  assert.deepEqual(thumbProblems(good, "unbelievable!!"), [], "the widest fitted title stays inside the margins");
  assert.ok(thumbProblems({ ...good, width: 720, height: 1280 }, "x")[0].startsWith("size 720x1280"));
  assert.deepEqual(thumbProblems({ ...good, luma: 5 }, "x"), ["frame is nearly black"]);
  assert.deepEqual(thumbProblems({ ...good, luma: 250 }, "x"), ["frame is nearly white"]);
  assert.match(thumbProblems({ ...good, bytes: THUMB_BYTES.min - 1 }, "x")[0], /KB/);
  assert.match(thumbProblems({ ...good, bytes: THUMB_BYTES.max + 1 }, "x")[0], /YouTube max/);
  assert.deepEqual(thumbProblems(good, "one two three four five six seven eight", 1, 1080, 400), ["size 1080x1920, expected 1080x400", "title outside the safe area"]);
  for (const t of ["a", "wwwwwww", "seven chars here", "a b c d e f g h i j k l m n o p q r s t u v w x y z"]) {
    const b = thumbTextBox(t), s = thumbTextBox(t, 1080, 1920, 0.85);
    assert.ok(b.x0 >= 1080 * 0.04 && b.x1 <= 1080 * 0.96, t);
    assert.ok(s.x1 - s.x0 < b.x1 - b.x0 && s.y1 - s.y0 < b.y1 - b.y0, "retry title is smaller");
  }
  assert.equal(Math.round(lumaOf([{ mean: 255 }, { mean: 255 }, { mean: 255 }])), 255);
  assert.equal(lumaOf([{ mean: 40 }]), 40);
});

test("review fixes: unknown bg colours are skipped, clipped html/body don't overflow", () => {
  const s = { fg: "rgb(200, 200, 200)", bgLayers: ["oklch(0.9 0.1 200)"], px: 16, bold: false, text: "pale" };
  assert.deepEqual(contrastIssues([s]), []);
  assert.equal(contrastIssues([{ ...s, bgLayers: ["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"] }]).length, 1);
  const wide = probe({ vw: 390, scrollWidth: 900 });
  assert.match(summarize({ statics: [], errors: [], missing: [], phone: wide }).line, /✗ phone overflow/);
  assert.match(summarize({ statics: [], errors: [], missing: [], phone: { ...wide, clipX: true } }).line, /✓ phone/);
  assert.match(summarize({ statics: [], errors: ["phone render failed: timeout"], missing: [], rendered: true }).line, /✗ page didn't render/);
});
