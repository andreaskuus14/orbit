import { test } from "node:test";
import assert from "node:assert/strict";
import { A4L, archCaption, cleanDraft, columnLines, draftInput, draftPrompt, parseDraftInput, escapeHtml, fitBox, layoutPortfolio, parsePortfolio, portfolioHtml, portfolioPdf, PMAX, type Portfolio, type Shot } from "../src/lib/portfolio-pure.ts";

// smallest valid baseline JPEG header bytes are enough: the PDF embeds them as they are
const JPG = `data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0fakejpeg\xff\xd9")}`;
const shot = (i: number, caption = `View ${i}`): Shot => ({ id: `s${i}`, src: JPG, w: 1600, h: 900, caption, at: "2026-10-26" });
const pf = (n: number, shots: number): Portfolio => ({
  name: "Andreas", title: "Portfolio 2026",
  projects: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: "arch" as const, title: `House ${i}`, year: "2026", text: "A small house.\nOn a north slope.", shots: Array.from({ length: shots }, (_, k) => shot(k)) })),
});

test("parsePortfolio drops bad shots and projects and caps text", () => {
  const p = parsePortfolio({ name: 5, projects: [
    { id: "a", kind: "nope", title: "", text: "x".repeat(5000), shots: [shot(1), { ...shot(2), src: "data:image/png;base64,AAAA" }, { ...shot(3), src: "javascript:alert(1)" }, { ...shot(4), w: -1 }] },
    { title: "no id" }, "junk",
  ] });
  assert.equal(p.name, "");
  assert.equal(p.title, "Portfolio");
  assert.equal(p.projects.length, 1);
  assert.equal(p.projects[0].kind, "arch");
  assert.equal(p.projects[0].title, "Untitled");
  assert.equal(p.projects[0].text.length, PMAX.text);
  assert.deepEqual(p.projects[0].shots.map((s) => s.id), ["s1"]);
  assert.deepEqual(parsePortfolio(null), { name: "", title: "Portfolio", projects: [] });
});

test("layout: cover, contents with right page numbers, continuation pages for many pictures", () => {
  const p = pf(2, 6); // 6 pictures → project page (4) + one continuation (2)
  const pages = layoutPortfolio(p);
  assert.equal(pages.length, 2 + 2 * 2);
  const contentsNums = pages[1].filter((it) => it.t === "text" && it.x === A4L.w - A4L.m - 30).map((it) => it.t === "text" && it.s);
  assert.deepEqual(contentsNums, ["3", "5"]);
  for (const pg of pages) for (const it of pg) if (it.t === "img") {
    assert.ok(it.x >= A4L.m - 0.01 && it.y >= A4L.m - 0.01 && it.x + it.w <= A4L.w - A4L.m + 0.01 && it.y + it.h <= A4L.h - A4L.m + 0.01, "picture inside the margins");
  }
  assert.equal(pages[3].filter((it) => it.t === "img").length, 2);
  assert.equal(layoutPortfolio(pf(0, 0)).length, 2);
});

test("fitBox keeps the aspect ratio and centres", () => {
  assert.deepEqual(fitBox(200, 100, 0, 0, 100, 100), { x: 0, y: 25, w: 100, h: 50 });
});

test("columnLines keeps paragraph breaks and ends an overflow with an ellipsis", () => {
  assert.deepEqual(columnLines("one\ntwo", 10, 200, 10), ["one", "", "two"]);
  const l = columnLines("word ".repeat(400), 10, 100, 3);
  assert.equal(l.length, 3);
  assert.ok(l[2].endsWith("…"));
});

test("PDF embeds each picture once and is a well-formed file", () => {
  const bytes = portfolioPdf(pf(1, 2));
  const s = new TextDecoder("latin1").decode(bytes);
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  assert.equal(s.match(/\/Subtype \/Image/g)?.length, 1); // same src on cover and both shots
  assert.match(s, /\/Im0 Do/);
  assert.match(s, /\/MediaBox \[0 0 842 595\]/);
  const xref = Number(s.match(/startxref\n(\d+)/)![1]);
  assert.equal(s.slice(xref, xref + 4), "xref");
});

test("HTML escapes every piece of his text and has no scripts", () => {
  const p = pf(1, 1);
  p.title = "<script>alert(1)</script>";
  p.projects[0].title = `"><img src=x onerror=alert(1)>`;
  p.projects[0].text = "a & b";
  p.projects[0].shots[0].caption = "<b>";
  const html = portfolioHtml(p);
  assert.ok(!/<script/i.test(html));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("a &amp; b") && html.includes("&lt;b&gt;"));
  assert.equal(escapeHtml(`'"`), "&#39;&quot;");
  assert.ok(html.includes(`src="${JPG}"`));
});

test("archCaption and the draft helpers", () => {
  const parts = [{ kind: "slab", w: 10, d: 8, y: 0, h: 0.2 }, { kind: "slab", w: 10, d: 8, y: 3, h: 0.2 }, { kind: "window", w: 1, d: 0.1, y: 1, h: 1 }];
  assert.equal(archCaption({ parts, mode: "model", sun: { date: "2026-06-21", hour: 15.5 } }), "Sun study 2026-06-21 15:30, 10×8 m footprint, 2 floors, 1 openings");
  assert.equal(archCaption({ parts: [], mode: "bp" }), "Blueprint view");
  assert.match(draftPrompt(draftInput(pf(1, 1).projects[0])), /"captions":\["View 0"\]/);
  assert.equal(parseDraftInput({ title: "  " }), null);
  assert.deepEqual(parseDraftInput({ title: "T", kind: "game", captions: ["a", 3, ""] }), { title: "T", kind: "game", year: "", text: "", captions: ["a"] });
  assert.equal(cleanDraft(`"**Hello** there\n\n\n\nok"`), "Hello there\n\nok");
});
