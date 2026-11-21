// ARCH studio drawings (pure, tested in tests/arch-drawing.test.ts). One list of drawing shapes, in plan metres, feeds three
// outputs so they always agree: the editable plan on screen, the SVG file and the measured-drawing PDF at a true scale.
// Drawn the way a plan is drawn by hand: cut walls filled solid (poché), door leaves with their swing, windows as three lines,
// two dimension chains outside (wall lines, then overall) in millimetres, each room's name, net area and inside size, a north
// arrow and a scale bar; the PDF adds a title block with the room table. North is up (−z).
import { pdfDoc, pdfString, pdfText, type PdfPage } from "./pdf-pure.ts";
import { dist, findRooms, footprints, nodeMap, planStats, wallEnds, wallSides, inPoly, type FloorPlan, type Room } from "./arch-floorplan-pure.ts";

type P = [number, number];
export type Cls = "wall" | "thin" | "glass" | "leaf" | "swing" | "dim" | "tick" | "room" | "area" | "size" | "dimtext" | "north";
export type Shape =
  | { t: "poly"; pts: P[]; cls: Cls; ref?: string }
  | { t: "line"; a: P; b: P; cls: Cls; ref?: string }
  | { t: "path"; pts: P[]; cls: Cls; ref?: string }
  | { t: "text"; p: P; s: string; size: number; cls: Cls; anchor: "start" | "middle" | "end"; rot?: 0 | -90; ref?: string };
/** size: text height in paper millimetres; the renderer turns it into metres at its scale. */
export type Drawing = { shapes: Shape[]; box: { x0: number; z0: number; x1: number; z1: number }; rooms: Room[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mmText = (m: number) => String(Math.round(m * 1000));
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k];

/** The plan → shapes. Dimension chains sit `gap` metres outside the outer wall faces. */
export function drawPlan(plan: FloorPlan, opts: { gap?: number } = {}): Drawing {
  const nm = nodeMap(plan), rooms = findRooms(plan), sides = wallSides(rooms);
  const shapes: Shape[] = [], deg = new Map<string, number>();
  for (const w of plan.walls) { deg.set(w.a, (deg.get(w.a) ?? 0) + 1); deg.set(w.b, (deg.get(w.b) ?? 0) + 1); }
  const roomPolys = rooms.map((r) => r.poly);
  for (const w of plan.walls) {
    const e = wallEnds(plan, w, nm);
    if (!e) continue;
    const L = dist(e[0], e[1]), u: P = [(e[1][0] - e[0][0]) / L, (e[1][1] - e[0][1]) / L], n: P = [-u[1], u[0]], h = w.t / 2;
    // reach into the corner at a joined end so corners are filled; a free end stops at its point
    const s0 = (deg.get(w.a) ?? 0) > 1 ? -h : 0, s1 = L + ((deg.get(w.b) ?? 0) > 1 ? h : 0);
    const ops = plan.openings.filter((o) => o.wall === w.id).sort((a, b) => a.at - b.at);
    let cur = s0;
    const piece = (from: number, to: number) => { if (to - from > 1e-3) shapes.push({ t: "poly", cls: "wall", ref: w.id, pts: [add(add(e[0], u, from), n, h), add(add(e[0], u, to), n, h), add(add(e[0], u, to), n, -h), add(add(e[0], u, from), n, -h)] }); };
    for (const o of ops) {
      const a = o.at - o.w / 2, b = o.at + o.w / 2;
      piece(cur, a); cur = b;
      const pa = add(e[0], u, a), pb = add(e[0], u, b);
      shapes.push({ t: "line", cls: "thin", ref: o.id, a: add(pa, n, h), b: add(pa, n, -h) }, { t: "line", cls: "thin", ref: o.id, a: add(pb, n, h), b: add(pb, n, -h) });
      if (o.kind === "window") {
        for (const k of [h, 0, -h]) shapes.push({ t: "line", cls: k === 0 ? "glass" : "thin", ref: o.id, a: add(pa, n, k), b: add(pb, n, k) });
      } else {
        // swing into a room: for an outer door the room side, else the +normal side; hinge at the start of the opening
        const probe = add(add(e[0], u, o.at), n, h + 0.3), toN = (sides.get(w.id)?.length ?? 0) < 2 ? roomPolys.some((p) => inPoly(probe, p)) : true;
        const nn: P = toN ? n : [-n[0], -n[1]], hinge = add(pa, nn, h), tip = add(hinge, nn, o.w);
        shapes.push({ t: "line", cls: "leaf", ref: o.id, a: hinge, b: tip });
        const arc: P[] = [];
        for (let i = 0; i <= 12; i++) { const t = (i / 12) * (Math.PI / 2); arc.push(add(add(hinge, nn, Math.cos(t) * o.w), u, Math.sin(t) * o.w)); }
        shapes.push({ t: "path", cls: "swing", ref: o.id, pts: arc });
      }
    }
    piece(cur, s1);
  }
  for (const r of rooms) {
    const [cx, cz] = r.centre;
    shapes.push({ t: "text", cls: "room", p: [cx, cz - 0.12], s: r.name, size: 2.5, anchor: "middle", ref: r.id });
    shapes.push({ t: "text", cls: "area", p: [cx, cz + 0.22], s: `${r.net.toFixed(1)} m²`, size: 2.2, anchor: "middle", ref: r.id });
    if (r.rect) shapes.push({ t: "text", cls: "size", p: [cx, cz + 0.5], s: `${mmText(r.rect.w)} × ${mmText(r.rect.d)}`, size: 1.8, anchor: "middle", ref: r.id });
  }
  // dimension chains: outside the outer faces on the north and west sides
  const fp = footprints(plan).flat(), all: P[] = fp.length ? fp : plan.nodes.map((q) => [q.x, q.z]);
  if (!all.length) return { shapes, box: { x0: 0, z0: 0, x1: 1, z1: 1 }, rooms };
  const X0 = Math.min(...all.map((p) => p[0])), X1 = Math.max(...all.map((p) => p[0])), Z0 = Math.min(...all.map((p) => p[1])), Z1 = Math.max(...all.map((p) => p[1]));
  const gap = opts.gap ?? 0.9, step = 0.6;
  const xsLine = [...new Set([X0, X1, ...plan.nodes.map((q) => q.x)])].filter((x) => x >= X0 - 1e-9 && x <= X1 + 1e-9).sort((a, b) => a - b);
  const zsLine = [...new Set([Z0, Z1, ...plan.nodes.map((q) => q.z)])].filter((z) => z >= Z0 - 1e-9 && z <= Z1 + 1e-9).sort((a, b) => a - b);
  const chain = (vals: number[], o: "h" | "v", at: number) => {
    const a = (v: number): P => (o === "h" ? [v, at] : [at, v]);
    shapes.push({ t: "line", cls: "dim", a: a(vals[0] - 0.2), b: a(vals[vals.length - 1] + 0.2) });
    for (const v of vals) { const p = a(v), d: P = o === "h" ? [0.12, -0.12] : [-0.12, 0.12]; shapes.push({ t: "line", cls: "tick", a: [p[0] - d[0], p[1] + d[1]], b: [p[0] + d[0], p[1] - d[1]] }); }
    for (let i = 0; i + 1 < vals.length; i++) {
      const len = vals[i + 1] - vals[i];
      if (len < 0.25) continue;
      const m = (vals[i] + vals[i + 1]) / 2;
      shapes.push(o === "h" ? { t: "text", cls: "dimtext", p: [m, at - 0.1], s: mmText(len), size: 1.8, anchor: "middle" } : { t: "text", cls: "dimtext", p: [at - 0.1, m], s: mmText(len), size: 1.8, anchor: "middle", rot: -90 });
    }
  };
  chain(xsLine, "h", Z0 - gap); chain([X0, X1], "h", Z0 - gap - step);
  chain(zsLine, "v", X0 - gap); chain([Z0, Z1], "v", X0 - gap - step);
  // north arrow (top right) and the chains' extent set the drawing box
  const nx = X1 + 1.2, nz = Z0 - gap - step;
  shapes.push({ t: "poly", cls: "north", pts: [[nx, nz - 0.5], [nx + 0.25, nz + 0.25], [nx, nz + 0.1], [nx - 0.25, nz + 0.25]] }, { t: "text", cls: "dimtext", p: [nx, nz - 0.65], s: "N", size: 2.5, anchor: "middle" });
  return { shapes, box: { x0: r3(X0 - gap - step - 0.6), z0: r3(Z0 - gap - step - 1), x1: r3(X1 + 1.7), z1: r3(Z1 + 0.6) }, rooms };
}

// ---------- SVG (screen and file) ----------
export const SVG_STYLE: Record<Cls, string> = {
  wall: "fill:#2f2b28;stroke:none", thin: "stroke:#2f2b28;stroke-width:0.02;fill:none", glass: "stroke:#3b82c4;stroke-width:0.03;fill:none",
  leaf: "stroke:#2f2b28;stroke-width:0.03;fill:none", swing: "stroke:#8a837b;stroke-width:0.015;fill:none;stroke-dasharray:0.08 0.06",
  dim: "stroke:#6b645d;stroke-width:0.015;fill:none", tick: "stroke:#6b645d;stroke-width:0.03;fill:none", north: "fill:#2f2b28;stroke:none",
  room: "fill:#2f2b28;font-weight:600", area: "fill:#4b4540", size: "fill:#8a837b", dimtext: "fill:#4b4540",
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pts = (l: P[]) => l.map((p) => `${r3(p[0])},${r3(p[1])}`).join(" ");
/** The drawing as a standalone SVG in metres (1 user unit = 1 m; text sized for 1:100 paper). */
export function planSvg(plan: FloorPlan, d = drawPlan(plan)): string {
  const { x0, z0, x1, z1 } = d.box, k = 0.1; // 1 mm of paper at 1:100 = 0.1 m
  const body = d.shapes.map((s) => {
    const st = SVG_STYLE[s.cls];
    if (s.t === "poly") return `<polygon points="${pts(s.pts)}" style="${st}"/>`;
    if (s.t === "line") return `<line x1="${r3(s.a[0])}" y1="${r3(s.a[1])}" x2="${r3(s.b[0])}" y2="${r3(s.b[1])}" style="${st}"/>`;
    if (s.t === "path") return `<polyline points="${pts(s.pts)}" style="${st}"/>`;
    const tr = s.rot ? ` transform="rotate(${s.rot} ${r3(s.p[0])} ${r3(s.p[1])})"` : "";
    return `<text x="${r3(s.p[0])}" y="${r3(s.p[1])}" font-size="${r3(s.size * k)}" text-anchor="${s.anchor}" style="${st};font-family:Helvetica,Arial,sans-serif"${tr}>${esc(s.s)}</text>`;
  }).join("\n");
  const W = r3(x1 - x0), H = r3(z1 - z0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r3(x0)} ${r3(z0)} ${W} ${H}" width="${r3(W * 10)}mm" height="${r3(H * 10)}mm">\n<title>${esc(plan.name)}: floor plan, metres, north up</title>\n<rect x="${r3(x0)}" y="${r3(z0)}" width="${W}" height="${H}" fill="#fbfaf7"/>\n${body}\n</svg>\n`;
}

// ---------- measured drawing PDF ----------
export const A3L = { w: 1190.55, h: 841.89 }; // ISO A3 landscape, points
export const PT_PER_MM = 72 / 25.4;
export const SCALES = [20, 50, 100, 200, 500];
const MARGIN = 15, TITLE_W = 80; // mm
/** The smallest standard scale (1:n) that fits the drawing in the sheet's drawing area. */
export function pickScale(box: Drawing["box"], page = A3L): number {
  const aw = page.w / PT_PER_MM - 2 * MARGIN - TITLE_W - 5, ah = page.h / PT_PER_MM - 2 * MARGIN;
  return SCALES.find((s) => ((box.x1 - box.x0) * 1000) / s <= aw && ((box.z1 - box.z0) * 1000) / s <= ah) ?? SCALES[SCALES.length - 1];
}
const PDF_LW: Partial<Record<Cls, number>> = { thin: 0.3, glass: 0.4, leaf: 0.5, swing: 0.25, dim: 0.25, tick: 0.6 };
const PDF_RGB: Partial<Record<Cls, string>> = { glass: "0.23 0.51 0.77", swing: "0.54 0.51 0.48", dim: "0.42 0.39 0.36", tick: "0.42 0.39 0.36", size: "0.54 0.51 0.48", area: "0.29 0.27 0.25", dimtext: "0.29 0.27 0.25" };
const f1 = (n: number) => n.toFixed(2);
/** Approximate Helvetica width (0.52 em per character), enough to centre labels. */
const textW = (s: string, size: number) => s.length * size * 0.52;

/** Text with "²" drawn as a small raised 2: the base-14 fonts have the glyph, but not every viewer's stand-in font does. */
function supText(x: number, y: number, font: "F1" | "F2", size: number, s: string): string {
  if (!s.includes("²")) return pdfText(x, y, font, size, s);
  const out: string[] = [];
  let cx = x;
  s.split("²").forEach((part, i) => {
    if (i) { out.push(pdfText(cx, y + size * 0.38, font, Number((size * 0.6).toFixed(2)), "2")); cx += textW("2", size * 0.6); }
    if (part) { out.push(pdfText(cx, y, font, size, part)); cx += textW(part, size); }
  });
  return out.join("\n");
}

export type SheetInfo = { date: string; author?: string; sourceLine: string };
/** The plan as a one-sheet A3 measured drawing at 1:n (picked to fit): plan, chains, title block with the room table. */
export function planPdf(plan: FloorPlan, info: SheetInfo, d = drawPlan(plan)): { bytes: Uint8Array; scale: number } {
  const scale = pickScale(d.box), k = (1000 / scale) * PT_PER_MM; // points per metre
  const ox = MARGIN * PT_PER_MM, top = A3L.h - MARGIN * PT_PER_MM;
  const X = (x: number) => ox + (x - d.box.x0) * k, Y = (z: number) => top - (z - d.box.z0) * k;
  const ops: string[] = ["1 J 1 j"];
  for (const s of d.shapes) {
    const rgb = PDF_RGB[s.cls] ?? "0.18 0.17 0.16";
    if (s.t === "poly") ops.push(`${rgb} rg ${s.pts.map((p, i) => `${f1(X(p[0]))} ${f1(Y(p[1]))} ${i ? "l" : "m"}`).join(" ")} h f`);
    else if (s.t === "line" || s.t === "path") {
      const l = s.t === "line" ? [s.a, s.b] : s.pts;
      ops.push(`${rgb} RG ${PDF_LW[s.cls] ?? 0.3} w ${s.cls === "swing" ? "[2 1.5] 0 d " : ""}${l.map((p, i) => `${f1(X(p[0]))} ${f1(Y(p[1]))} ${i ? "l" : "m"}`).join(" ")} S${s.cls === "swing" ? " [] 0 d" : ""}`);
    } else {
      const size = s.size * PT_PER_MM * 0.75, font = s.cls === "room" ? "F2" : "F1", w = textW(s.s, size);
      const dx = s.anchor === "middle" ? -w / 2 : s.anchor === "end" ? -w : 0;
      ops.push(`${rgb} rg`);
      if (s.rot === -90) ops.push(`BT /${font} ${f1(size)} Tf 0 1 -1 0 ${f1(X(s.p[0]))} ${f1(Y(s.p[1]) + dx)} Tm ${pdfString(s.s)} Tj ET`);
      else ops.push(supText(X(s.p[0]) + dx, Y(s.p[1]), font, Number(f1(size)), s.s));
    }
  }
  // scale bar: 0–5 m (0–1 m at 1:20), under the plan
  const bar = scale <= 20 ? 1 : 5, by = MARGIN * PT_PER_MM + 8, bx = ox;
  ops.push("0.18 0.17 0.16 RG 0.18 0.17 0.16 rg 0.5 w");
  for (let i = 0; i < bar; i++) ops.push(`${f1(bx + i * k)} ${by} ${f1(k)} 3 re ${i % 2 ? "S" : "B"}`);
  ops.push(pdfText(bx, by + 6, "F1", 7, "0"), pdfText(bx + bar * k - 3, by + 6, "F1", 7, `${bar} m`), pdfText(bx + bar * k + 8, by, "F1", 7, `1:${scale}`));
  // title block
  const tx = A3L.w - (MARGIN + TITLE_W) * PT_PER_MM, tw = TITLE_W * PT_PER_MM, tb = MARGIN * PT_PER_MM;
  ops.push(`0.18 0.17 0.16 RG 0.8 w ${f1(tx)} ${f1(tb)} ${f1(tw)} ${f1(top - tb)} re S`);
  const st = planStats(plan, d.rooms);
  let y = top - 22;
  const line = (s: string, size = 8, font: "F1" | "F2" = "F1", gapAfter = 4) => { ops.push(supText(tx + 8, y, font, size, s.slice(0, 60))); y -= size + gapAfter; };
  line(plan.name, 14, "F2", 6);
  line("Floor plan, ground floor", 9);
  line(`Scale 1:${scale} on A3 · dimensions in mm · areas in m²`, 8, "F1", 10);
  line("Room", 8, "F2", 4);
  ops.push(`0.5 w ${f1(tx + 8)} ${f1(y + 8.5)} m ${f1(tx + tw - 8)} ${f1(y + 8.5)} l S`);
  for (const r of d.rooms.slice(0, 30)) {
    const a = `${r.net.toFixed(1)}`;
    ops.push(pdfText(tx + 8, y, "F1", 8, r.name.slice(0, 34)), pdfText(tx + tw - 8 - textW(a, 8), y, "F1", 8, a));
    y -= 11;
  }
  ops.push(`0.5 w ${f1(tx + 8)} ${f1(y + 7.5)} m ${f1(tx + tw - 8)} ${f1(y + 7.5)} l S`);
  const tot = (label: string, v: number) => { const a = v.toFixed(1); ops.push(pdfText(tx + 8, y, "F2", 8, label), pdfText(tx + tw - 8 - textW(a, 8), y, "F2", 8, a)); y -= 12; };
  tot("Net floor area (inside walls)", st.net);
  tot("Gross area (to wall centre lines)", st.gross);
  tot("Footprint (outside faces)", st.footprint);
  y -= 8;
  line(`Room height ${plan.height.toFixed(2)} m · ${st.doors} doors · ${st.windows} windows`, 7.5);
  line(info.sourceLine, 7.5);
  line(`Drawn ${info.date}${info.author ? ` · ${info.author}` : ""} · ORBIT ARCH`, 7.5, "F1", 10);
  for (const s of ["Study drawing, not for building.", "Areas: net = to inside wall faces, gross = to", "wall centre lines. Check all sizes on site."]) line(s, 7, "F1", 2);
  const page: PdfPage = { ops };
  return { bytes: pdfDoc([page], A3L, `${plan.name}: floor plan 1:${scale}`), scale };
}
/** Points per metre on the sheet at 1:n (for checks). */
export const ptPerMetre = (scale: number) => (1000 / scale) * PT_PER_MM;
