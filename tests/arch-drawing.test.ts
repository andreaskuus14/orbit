import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText, getDocumentProxy } from "unpdf";
import { samplePlan, findRooms } from "../src/lib/arch-floorplan-pure.ts";
import { A3L, drawPlan, pickScale, planPdf, planSvg, ptPerMetre, PT_PER_MM } from "../src/lib/arch-drawing-pure.ts";

test("drawing shapes: walls with gaps for every opening, two chains each side, a label per room", () => {
  const p = samplePlan(), d = drawPlan(p);
  const leaves = d.shapes.filter((s) => s.cls === "leaf"), glass = d.shapes.filter((s) => s.cls === "glass");
  assert.equal(leaves.length, p.openings.filter((o) => o.kind === "door").length);
  assert.equal(glass.length, p.openings.filter((o) => o.kind === "window").length);
  assert.equal(d.shapes.filter((s) => s.cls === "room").length, findRooms(p).length);
  // overall chains read the outside faces: 12 300 wide and 12 300 deep (garage wing included)
  const dims = d.shapes.filter((s) => s.t === "text" && s.cls === "dimtext").map((s) => (s.t === "text" ? s.s : ""));
  assert.equal(dims.filter((s) => s === "12300").length, 2);
  // the inner chain runs between the outer wall centre lines (12 000); the two 150 mm half-walls outside it carry no text
  const top = d.shapes.filter((s) => s.t === "text" && s.cls === "dimtext" && !s.rot && s.s !== "12300" && s.s !== "N").map((s) => (s.t === "text" ? Number(s.s) : 0));
  assert.equal(top.reduce((a, b) => a + b, 0), 12000);
});

test("SVG is well-formed, in metres, escapes names", () => {
  const p = { ...samplePlan(), name: "A & B <house>" }, svg = planSvg(p);
  assert.match(svg, /^<\?xml/); assert.match(svg, /viewBox="[-\d. ]+"/); assert.ok(svg.includes("A &amp; B &lt;house&gt;"));
  assert.equal((svg.match(/<svg/g) ?? []).length, 1); assert.ok(svg.trim().endsWith("</svg>"));
});

test("PDF at true scale: 1:100 on A3, read back by pdf.js with the room names, areas and scale", async () => {
  const p = samplePlan(), d = drawPlan(p), { bytes, scale } = planPdf(p, { date: "2026-11-21", sourceLine: "Sample plan" }, d);
  assert.equal(scale, 100);
  assert.equal(pickScale({ x0: 0, z0: 0, x1: 4, z1: 3 }), 20); assert.equal(pickScale({ x0: 0, z0: 0, x1: 90, z1: 60 }), 500);
  near(ptPerMetre(100), 10 * PT_PER_MM); // 1 m = 10 mm on paper = 28.35 pt
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  assert.equal(pdf.numPages, 1);
  const page = await pdf.getPage(1), vp = page.getViewport({ scale: 1 });
  near(vp.width, A3L.w, 0.01); near(vp.height, A3L.h, 0.01);
  const { text } = await extractText(pdf, { mergePages: true });
  for (const s of ["Sample house", "Scale 1:100 on A3", "Kitchen + living", "Garage", "12300", "108.5", "Net floor area"]) assert.ok(text.includes(s), `${s} missing`);
  // the 12.3 m dimension line is drawn 12.3 × 28.35 pt long (+0.2 m overshoot each side): find a stroke of that length
  const ops = new TextDecoder("latin1").decode(bytes).match(/[\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S/g) ?? [];
  const want = (12.3 + 0.4) * ptPerMetre(100);
  assert.ok(ops.some((o) => { const [x0, y0, , x1, y1] = o.split(" ").map(Number); return Math.abs(Math.hypot(x1 - x0, y1 - y0) - want) < 0.05; }), "overall dimension line at scale");
});

function near(a: number, b: number, tol = 1e-6) { assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`); }
