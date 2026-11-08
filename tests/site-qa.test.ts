import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HERO_SCRIM, parseBrief, renderSite } from "../src/lib/site-brief-pure.ts";
import { altIssues, formIssues, headingIssues, heroIssues, keyboardIssues, linkIssues, metaIssues, qaMarkdown, qaPacket, scrimContrast, type FormRun, type ViewRun } from "../src/lib/site-qa-pure.ts";
import { lintSite } from "../src/lib/site-pipeline-pure.ts";

const read = (n: string) => readFileSync(new URL(`./fixtures/site-w02/${n}`, import.meta.url), "utf8");
const brief = (() => { const p = parseBrief(JSON.parse(read("brief-detailed.json"))); if ("errors" in p) throw new Error(); return p.brief; })();
const site = renderSite(brief), html = site["index.html"];
const FILES = new Set(["index.html", "css/style.css", "js/form.js", "assets/hero.jpg", "assets/lantern.jpg"]);
const goodForm: FormRun = { emptyBlocked: true, invalid: 3, summary: true, focusOnError: true, badEmailBlocked: true, accepted: true, received: 1, status: "Thanks, Ann." };
const view = (vw: number, extra: Partial<ViewRun> = {}): ViewRun => ({ vw, shot: `qa/${vw}.jpg`, hero: null,
  probe: { vw, scrollWidth: vw, textLen: 999, media: 5, badImgs: [], samples: [{ fg: "rgb(20, 35, 43)", bgLayers: ["rgb(255, 255, 255)"], px: 17, bold: false, text: "ok" }] },
  keyboard: { focusables: ["a#x", "button"], reached: ["a#x", "button"], noFocusStyle: [] }, ...extra });

test("rendered page passes the static checks (headings, alt, meta, links) and the existing lint", () => {
  assert.deepEqual(headingIssues(html), []);
  assert.deepEqual(altIssues(html), []);
  assert.deepEqual(metaIssues(html), []);
  assert.deepEqual(linkIssues(html, "index.html", FILES), []);
  assert.deepEqual(lintSite({ html: [{ path: "index.html", text: html }], css: [{ path: "css/style.css", text: site["css/style.css"] }], images: [] }), []);
});

test("failing control: the broken fixture fails every static check", () => {
  const bad = read("broken.html");
  assert.ok(headingIssues(bad).some((i) => /0 <h1>/.test(i)) && headingIssues(bad).some((i) => /h2 to h4/.test(i)));
  assert.equal(altIssues(bad).length, 2);
  assert.ok(metaIssues(bad).includes("no <title>") && metaIssues(bad).includes("<html> has no lang"));
  const links = linkIssues(bad, "index.html", new Set(["index.html", "assets/hero.jpg"]));
  for (const want of [/root path \/css/, /missing file: assets\/missing\.jpg/, /#nowhere/, /about\.html/]) assert.ok(links.some((l) => want.test(l)), String(want));
});

test("runtime verdicts: overflow, contrast, keyboard, hero crop, form", () => {
  assert.ok(qaPacket({ html, files: FILES, version: "2", views: [360, 390, 768, 1440].map((w) => view(w)), form: goodForm }).pass);
  const p = qaPacket({ html, files: FILES, version: "2", form: { ...goodForm, received: 0, accepted: false, emptyBlocked: false }, views: [
    view(360, { probe: { ...view(360).probe, scrollWidth: 2000, badImgs: ["assets/lantern.jpg"], samples: [{ fg: "rgb(187, 187, 187)", bgLayers: ["rgb(255, 255, 255)"], px: 16, bold: false, text: "grey" }] } }),
    view(1440, { keyboard: { focusables: ["a#x", "input#y"], reached: ["a#x"], noFocusStyle: ["a#x"], clickOnly: ["div"] } }),
  ] });
  const failed = Object.fromEntries(p.checks.map((c) => [c.name, c.ok]));
  assert.deepEqual(failed, { "No sideways scroll": false, "Heading order": true, "Alt text": true, Contrast: false, Keyboard: false, "Links and assets": false, Metadata: true, "Hero crop": true, Form: false });
  assert.match(qaMarkdown(p), /FAIL/);
  assert.equal(keyboardIssues({ focusables: ["a"], reached: [], noFocusStyle: [], clickOnly: ["div"] }).length, 2);
  assert.ok(formIssues(null).length && formIssues(goodForm).length === 0);
  assert.ok(!qaPacket({ html, files: FILES, version: "2", views: [], form: goodForm }).pass, "no browser = not a pass");
});

test("hero: subject under the text or cropped off is flagged; scrim worst case is readable", () => {
  const a = brief.assets[0];
  assert.deepEqual(heroIssues({ boxW: 1440, boxH: 800, posX: 0.58, posY: 0.5, copy: [0.08, 0.4] }, a, 1440), []);
  assert.match(heroIssues({ boxW: 1440, boxH: 800, posX: 1, posY: 0.5, copy: [0.08, 0.9] }, a, 1440)[0], /under the text/);
  assert.match(heroIssues({ boxW: 300, boxH: 1600, posX: 0, posY: 0.5, copy: null }, { ...a, focal: { x: 0.99, y: 0.5 } }, 300)[0], /cropped off/);
  assert.ok(scrimContrast([243, 246, 247, 1], HERO_SCRIM) >= 4.5);
  assert.ok(scrimContrast([214, 224, 228, 1], HERO_SCRIM) >= 4.5);
  assert.ok(scrimContrast([243, 246, 247, 1], [11, 33, 44, 0.3]) < 4.5, "a thin scrim fails");
});
