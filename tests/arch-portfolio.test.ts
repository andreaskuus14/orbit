import { test } from "node:test";
import assert from "node:assert/strict";
import { A4L } from "../src/lib/portfolio-pure.ts";
import { starterScene, type Scene } from "../src/lib/arch-pure.ts";
import { generatePlans, parseBrief, planScene, STARTER_BRIEF } from "../src/lib/arch-plan-pure.ts";
import { sceneVersion } from "../src/lib/arch-crit-pure.ts";
import { archPortfolioPdf, critHighlights, fmt, keyNumbers, layoutArchPortfolio, planItems, type ArchPortfolio, type ArchProject } from "../src/lib/arch-portfolio-pure.ts";

const brief = parseBrief(STARTER_BRIEF.rooms, STARTER_BRIEF.adj, { w: 30, d: 25 }, 1);
const house: Scene = planScene(brief, generatePlans(brief)[0]);
const shot = { w: 1600, h: 900, bytes: "\xff\xd8\xff\xe0fakejpeg\xff\xd9" };
const proj = (i: number, o: Partial<ArchProject> = {}): ArchProject => ({ title: `House ${i}`, brief: "A small house on a north slope.", at: `2026-10-0${i + 1}T10:00:00Z`, scene: house, shot, crits: [], ...o });
const pf = (projects: ArchProject[], lang: "en" | "et" = "en"): ArchPortfolio => ({ title: "Portfolio 2026", name: "Andreas", lang, projects });
const texts = (pg: ReturnType<typeof layoutArchPortfolio>[number]) => pg.flatMap((it) => (it.t === "text" ? [it.s] : []));
const inside = (pages: ReturnType<typeof layoutArchPortfolio>) => {
  for (const pg of pages) for (const it of pg) {
    if (it.t === "img" || it.t === "rect") assert.ok(it.x >= A4L.m - 0.5 && it.y >= A4L.m - 0.5 && it.x + it.w <= A4L.w - A4L.m + 0.5 && it.y + it.h <= A4L.h - A4L.m + 0.5, `${it.t} inside the margins`);
    if (it.t === "text") assert.ok(it.y >= 10 && it.y <= A4L.h - A4L.m, "text on the page");
  }
};

test("page count: cover + one page per short project + closing contents with right page numbers", () => {
  const pages = layoutArchPortfolio(pf([proj(0), proj(1), proj(2)]));
  assert.equal(pages.length, 1 + 3 + 1);
  const last = pages[pages.length - 1];
  assert.equal(texts(last)[0], "Contents");
  assert.deepEqual(last.filter((it) => it.t === "text" && it.x === A4L.w - A4L.m - 30).map((it) => it.t === "text" && it.s), ["2", "3", "4"]);
  assert.equal(pages[1].filter((it) => it.t === "img").length, 1);
  inside(pages);
  assert.equal(layoutArchPortfolio(pf([])).length, 2, "empty: cover + contents");
});

test("overflow: a long brief and many crits run onto a continuation page; contents numbers shift", () => {
  const long = Array.from({ length: 24 }, (_, i) => `Paragraph ${i} about the courtyard, the light and the stair.`).join("\n"); // under APF_MAX.brief
  const pages = layoutArchPortfolio(pf([proj(0, { brief: long, crits: ["+ Good south light", "– Long corridor", "→ Turn the plan so the living room faces south and the stair sits on the north wall."] }), proj(1)]));
  assert.ok(pages.length >= 1 + 2 + 1 + 1);
  assert.ok(texts(pages[2]).some((s) => s.includes("(continued)")));
  const all = pages.flatMap(texts);
  assert.ok(all.some((s) => s.startsWith("Paragraph 23")) && all.some((s) => s.startsWith("→ Turn the plan")), "last paragraph still printed");
  assert.ok(all.includes("+ Good south light") && all.some((s) => s.startsWith("KEY NUMBERS")));
  const nums = pages[pages.length - 1].filter((it) => it.t === "text" && it.x === A4L.w - A4L.m - 30).map((it) => it.t === "text" && it.s);
  assert.equal(nums[1], String(pages.findIndex((pg) => texts(pg).includes("House 1")) + 1));
  inside(pages);
});

test("text wrapping: brief lines fit the column; long words are broken", () => {
  const pages = layoutArchPortfolio(pf([proj(0, { brief: `${"x".repeat(200)} short words after it` })]));
  const col = pages[1].filter((it) => it.t === "text" && it.size === 10 && it.x === A4L.m);
  assert.ok(col.length >= 3);
  for (const it of col) if (it.t === "text") assert.ok(it.s.length * 10 * 0.5 <= 250 + 0.01, `"${it.s}" fits 250 pt`);
});

test("key numbers come from the geometry, in both languages", () => {
  const en = Object.fromEntries(keyNumbers(starterScene(), "en"));
  assert.equal(en["Plot"], "30 × 25 m = 750 m²");
  assert.equal(en["Gross floor area"], "80 m²");
  assert.equal(en["FAR (floor area ratio)"], "0.11");
  const et = Object.fromEntries(keyNumbers(starterScene(), "et"));
  assert.equal(et["Krundi täisehitusindeks"], "0,11");
  assert.equal(fmt(12.345, "et", 2), "12,35");
  assert.ok(keyNumbers(house, "en").some(([k]) => k === "Direct sun"), "generated house has windows → sun row");
});

test("plan: walls, openings and a scale bar inside the box; no walls → a note", () => {
  const box = { x: 100, y: 50, w: 400, h: 200 }, it = planItems(house, box, "en");
  assert.ok(it.filter((x) => x.t === "rect").length > 5);
  for (const x of it) if (x.t === "rect") assert.ok(x.x >= box.x - 0.5 && x.x + x.w <= box.x + box.w + 0.5 && x.y >= box.y - 0.5 && x.y + x.h <= box.y + box.h + 0.5);
  assert.deepEqual(planItems({ ...starterScene(), parts: [] }, box, "et").map((x) => x.t === "text" && x.s), ["Selles versioonis pole seinu."]);
});

test("crit highlights: only the crit for this exact version, without the fact references", () => {
  const v = sceneVersion(house);
  const content = "# Studio crit\n\n## Strengths\n- Clear entrance\n- Good kitchen light\n- third\n\n## Concerns\n- Corridor too long (F3: Circulation 20%)\n- Bath dark (F4: x)\n\n## Try this\nMove the bath.\n\n## Questions\n- Why?";
  assert.deepEqual(critHighlights([{ content: "## Strengths\n- other", tags: ["arch", "crit", "model:00000000"] }, { content, tags: ["arch", "crit", `model:${v}`] }], house),
    ["+ Clear entrance", "+ Good kitchen light", "– Corridor too long", "– Bath dark", "→ Move the bath."]);
  assert.deepEqual(critHighlights([{ content, tags: ["arch", "lesson", `model:${v}`] }], house), []);
});

test("PDF: valid file with one image per captured project and Estonian letters", () => {
  const bytes = archPortfolioPdf(pf([proj(0, { title: "Õueala maja" }), proj(1, { shot: null })], "et"));
  const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  assert.equal(s.match(/\/Subtype \/Image/g)?.length, 1);
  assert.ok(s.includes("/Count 4"));
  assert.ok(s.includes("(\xd5ueala maja)") && s.includes("Sisukord"));
});
