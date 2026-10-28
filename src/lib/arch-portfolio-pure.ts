// ARCH portfolio (roadmap 8, 6.2), pure and tested in tests/arch-portfolio.test.ts: saved ARCH versions he picks → an A4 landscape
// PDF: cover, one page per project (title, brief, 3D render, vector plan, key numbers, crit highlights; text that doesn't fit runs
// onto continuation pages), then a closing contents page. Built in the browser and downloaded; nothing is published.
import { pdfDoc, pdfImage, pdfText, pdfWrap, type PdfFont, type PdfJpeg, type PdfPage } from "./pdf-pure.ts";
import { A4L, fitBox } from "./portfolio-pure.ts";
import { RULES, isStraightWall, type Part, type Scene } from "./arch-pure.ts";
import { rooms, sceneVersion } from "./arch-crit-pure.ts";
import { unionArea } from "./arch-site-pure.ts";
import { daylightPlan, studyMonth, summarize } from "./arch-daylight-pure.ts";

export type Lang = "en" | "et";
export const APF_MAX = { projects: 20, brief: 1500, title: 80 };
/** One project = one saved version: his title and brief, the version's scene, an optional JPEG render, crit highlight lines. */
export type ArchProject = { title: string; brief: string; at: string; scene: Scene; shot: PdfJpeg | null; crits: string[] };
export type ArchPortfolio = { title: string; name: string; lang: Lang; projects: ArchProject[] };

export const APF_TEXT = {
  en: { cover: "Architecture portfolio", contents: "Contents", numbers: "Key numbers", crit: "Crit highlights", plan: "Plan", floor: "Floor", cont: "continued",
    plot: "Plot", floors: "Floors", gross: "Gross floor area", net: "Room area", rooms: "rooms", foot: "Footprint", cover2: "coverage", far: "FAR (floor area ratio)",
    glass: "Glazing", ofRooms: "of room area", sun: "Direct sun", sunVal: "{h} h/yr per room (avg), {n} of {t} rooms no Dec sun", version: "version",
    projects: "projects", noWalls: "No walls in this version.", sunNote: "Sun: Tallinn, 21st of each month, direct sun through windows." },
  et: { cover: "Arhitektuuriportfoolio", contents: "Sisukord", numbers: "Põhinäitajad", crit: "Kriitika põhipunktid", plan: "Plaan", floor: "Korrus", cont: "järg",
    plot: "Krunt", floors: "Korruseid", gross: "Brutopind", net: "Ruumide pind", rooms: "ruumi", foot: "Ehitisealune pind", cover2: "täisehitus", far: "Krundi täisehitusindeks",
    glass: "Klaaspind", ofRooms: "ruumide pinnast", sun: "Otsene päike", sunVal: "{h} h/a ruumi kohta (kesk.), {n}/{t} ruumi detsembris päikeseta", version: "versioon",
    projects: "projekti", noWalls: "Selles versioonis pole seinu.", sunNote: "Päike: Tallinn, iga kuu 21. kuupäev, otsene päike läbi akende." },
} as const;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
/** Estonian writes 12,5 where English writes 12.5. */
export const fmt = (n: number, lang: Lang, digits = 1) => { const s = String(Math.round(n * 10 ** digits) / 10 ** digits); return lang === "et" ? s.replace(".", ",") : s; };

/* ---- facts ---- */
const shells = (s: Scene) => s.parts.filter((p) => p.kind === "wall" && !isStraightWall(p));

/** Key numbers, all computed from the version's geometry: [label, value] rows. Sun only when the walls enclose rooms with windows. */
export function keyNumbers(scene: Scene, lang: Lang, site = { lat: 59.437, lon: 24.754 }): [string, string][] {
  const T = APF_TEXT[lang], f = (n: number, d = 1) => fmt(n, lang, d);
  const plotA = scene.plot.w * scene.plot.d, sh = shells(scene), gross = sh.reduce((s, p) => s + p.w * p.d, 0);
  const rs = rooms(scene), net = rs.reduce((s, r) => s + r.area, 0);
  const foot = unionArea(scene.parts.filter((p) => p.kind === "wall" || p.kind === "slab").map((p) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 })));
  const glass = scene.parts.filter((p) => p.kind === "window").reduce((s, p) => s + p.w * p.h, 0);
  const out: [string, string][] = [
    [T.plot, `${f(scene.plot.w)} × ${f(scene.plot.d)} m = ${f(plotA, 0)} m²`],
    [T.floors, String(sh.length)],
    [T.gross, `${f(gross)} m²`],
    [T.net, `${f(net)} m², ${rs.length} ${T.rooms}`],
    [T.foot, `${f(foot)} m², ${f(plotA ? (foot / plotA) * 100 : 0, 0)}% ${T.cover2}`],
    [T.far, f(plotA ? gross / plotA : 0, 2)],
  ];
  if (net) out.push([T.glass, `${f(glass)} m² = ${f((glass / net) * 100, 0)}% ${T.ofRooms}`]);
  try {
    const plan = daylightPlan(scene.parts);
    if (plan.rooms.length && plan.windows.length) {
      const res = summarize(plan, Array.from({ length: 12 }, (_, m) => studyMonth(plan, site, m)));
      const avg = res.reduce((s, r) => s + r.annualHours, 0) / res.length;
      out.push([T.sun, fill(T.sunVal, { h: Math.round(avg), n: res.filter((r) => r.noDecSun).length, t: res.length })]);
    }
  } catch { /* a model too big for the daylight grid just has no sun row */ }
  return out;
}

/** Crit notes (ARCH studio memories) for exactly this version → up to 2 strengths, 2 concerns and the "try this", newest crit first. */
export function critHighlights(rows: { content: string; tags: string[] | null }[], scene: Scene): string[] {
  const tag = `model:${sceneVersion(scene)}`, row = rows.find((r) => (r.tags ?? []).includes("crit") && (r.tags ?? []).includes(tag));
  if (!row) return [];
  const sec = (name: string) => (row.content.split(/\n(?=## )/).find((b) => b.startsWith(`## ${name}\n`)) ?? "").split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
  const bullets = (name: string) => sec(name).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/\s*\(F\d+:[\s\S]*\)$/, "").trim()).filter(Boolean);
  return [...bullets("Strengths").slice(0, 2).map((s) => `+ ${s}`), ...bullets("Concerns").slice(0, 2).map((s) => `– ${s}`), ...sec("Try this").slice(0, 1).map((s) => `→ ${s}`)];
}

/* ---- drawing items (points, origin bottom-left) ---- */
export type Item =
  | { t: "text"; x: number; y: number; font: PdfFont; size: number; s: string }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; lw: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; lw: number; fill?: number /* grey 0–1; no stroke when lw = 0 */ }
  | { t: "img"; i: number; x: number; y: number; w: number; h: number };
type Box = { x: number; y: number; w: number; h: number };

/** Vector plan of every floor, side by side at one scale, north up (−Z): walls as outlines (outer shells hollow, inner walls filled),
 *  windows as a white gap with a glass line, doors as a gap with the leaf drawn open, stairs as a crossed box; a 5 m scale bar. */
export function planItems(scene: Scene, box: Box, lang: Lang): Item[] {
  const T = APF_TEXT[lang], walls = scene.parts.filter((p) => p.kind === "wall");
  if (!walls.length) return [{ t: "text", x: box.x, y: box.y + box.h - 10, font: "F3", size: 9, s: T.noWalls }];
  const lvl = (p: Part) => Math.round(p.y * 10) / 10;
  const levels = [...new Set(walls.map(lvl))].sort((a, b) => a - b).slice(0, 4); // shortcut: 4 floors drawn at most; the plan generator makes ≤ 3
  const ext = [...walls, ...scene.parts.filter((p) => p.kind === "stair")];
  const x0 = Math.min(...ext.map((p) => p.x - p.w / 2)), x1 = Math.max(...ext.map((p) => p.x + p.w / 2));
  const z0 = Math.min(...ext.map((p) => p.z - p.d / 2)), z1 = Math.max(...ext.map((p) => p.z + p.d / 2));
  const gap = 14, head = 14, foot = 18, n = levels.length, bw = (box.w - gap * (n - 1)) / n, bh = box.h - head - foot;
  const k = Math.min(bw / Math.max(1, x1 - x0), bh / Math.max(1, z1 - z0)), pw = (x1 - x0) * k, ph = (z1 - z0) * k;
  const out: Item[] = [];
  levels.forEach((ly, f) => {
    const ox = box.x + f * (bw + gap) + (bw - pw) / 2, oy = box.y + foot + (bh - ph) / 2 + ph; // oy = page y of z0 (north edge)
    const X = (x: number) => ox + (x - x0) * k, Y = (z: number) => oy - (z - z0) * k;
    const r = (cx: number, cz: number, w: number, d: number, lw: number, fillG?: number): Item => ({ t: "rect", x: X(cx - w / 2), y: Y(cz + d / 2), w: w * k, h: d * k, lw, ...(fillG === undefined ? {} : { fill: fillG }) });
    out.push({ t: "text", x: box.x + f * (bw + gap), y: box.y + box.h - 9, font: "F2", size: 8, s: n > 1 ? `${T.floor} ${f + 1}` : T.plan });
    const here = walls.filter((p) => lvl(p) === ly), ids = new Set(here.map((p) => p.id));
    for (const p of here) {
      if (isStraightWall(p)) { out.push(r(p.x, p.z, p.w, p.d, 0.4, 0.25)); continue; }
      const t = RULES.wallThick;
      out.push(r(p.x, p.z, p.w, p.d, 0.9), r(p.x, p.z, Math.max(0, p.w - 2 * t), Math.max(0, p.d - 2 * t), 0.5));
    }
    for (const s of scene.parts.filter((p) => p.kind === "stair" && Math.abs(p.y - ly) < 0.5)) {
      const it = r(s.x, s.z, s.w, s.d, 0.4) as Extract<Item, { t: "rect" }>;
      out.push(it, { t: "line", x1: it.x, y1: it.y, x2: it.x + it.w, y2: it.y + it.h, lw: 0.3 });
    }
    for (const o of scene.parts.filter((p) => (p.kind === "window" || p.kind === "door") && p.host && ids.has(p.host) && p.face)) {
      const host = here.find((p) => p.id === o.host)!, ns = o.face === "n" || o.face === "s";
      const th = isStraightWall(host) ? (ns ? host.d : host.w) : RULES.wallThick, inward = o.face === "n" || o.face === "w" ? 1 : -1;
      const cx = ns ? o.x : o.x + (inward * th) / 2, cz = ns ? o.z + (inward * th) / 2 : o.z, w = ns ? o.w : th, d = ns ? th : o.w;
      out.push(r(cx, cz, w, d, 0, 1)); // white gap in the wall
      if (o.kind === "window") out.push(r(cx, cz, w, d, 0.3), ns ? { t: "line", x1: X(cx - w / 2), y1: Y(cz), x2: X(cx + w / 2), y2: Y(cz), lw: 0.3 } : { t: "line", x1: X(cx), y1: Y(cz - d / 2), x2: X(cx), y2: Y(cz + d / 2), lw: 0.3 });
      else { // leaf hinged at one jamb, swung 90° into the room
        const hx = ns ? o.x - o.w / 2 : o.x + inward * th, hz = ns ? o.z + inward * th : o.z - o.w / 2;
        out.push({ t: "line", x1: X(hx), y1: Y(hz), x2: X(ns ? hx : hx + inward * o.w), y2: Y(ns ? hz + inward * o.w : hz), lw: 0.5 });
      }
    }
  });
  const bar = 5 * k; // 5 m scale bar and north arrow under the first floor
  out.push({ t: "line", x1: box.x, y1: box.y + 6, x2: box.x + bar, y2: box.y + 6, lw: 1.2 }, { t: "text", x: box.x + bar + 4, y: box.y + 3, font: "F1", size: 7, s: "5 m" },
    { t: "line", x1: box.x + bar + 30, y1: box.y + 1, x2: box.x + bar + 30, y2: box.y + 13, lw: 0.6 }, { t: "text", x: box.x + bar + 33, y: box.y + 7, font: "F2", size: 7, s: "N" });
  return out;
}

/* ---- text flow ---- */
type Row = { h: number; draw: (x: number, y: number, w: number) => Item[] }; // y = top of the row
type Frame = { x: number; top: number; bottom: number; w: number };
const textRows = (s: string, font: PdfFont, size: number, lead: number, w: number): Row[] =>
  s.split(/\n+/).filter((p) => p.trim()).flatMap((p) => pdfWrap(p, size, w)).map((l) => ({ h: lead, draw: (x, y) => [{ t: "text", x, y: y - size, font, size, s: l }] }));
const gapRow = (h: number): Row => ({ h, draw: () => [] });
const headRow = (s: string): Row => ({ h: 18, draw: (x, y, w) => [{ t: "text", x, y: y - 9, font: "F2", size: 8, s: s.toUpperCase() }, { t: "line", x1: x, y1: y - 13, x2: x + w, y2: y - 13, lw: 0.4 }] });

/** Rows into frames in order; a row that doesn't fit starts the next frame. extra() supplies more frames (continuation pages).
 *  Returns items per frame used. A row taller than a whole frame still gets its own frame (and overflows it) rather than looping. */
export function flow(rows: Row[], frames: Frame[], extra: () => Frame[]): Item[][] {
  const out: Item[][] = [];
  let fi = 0, y = frames[0].top, cur: Item[] = [];
  for (const row of rows) {
    if (y - row.h < frames[fi].bottom && y < frames[fi].top) {
      out.push(cur); cur = []; fi++;
      if (fi >= frames.length) frames.push(...extra());
      y = frames[fi].top;
    }
    cur.push(...row.draw(frames[fi].x, y, frames[fi].w)); y -= row.h;
  }
  out.push(cur);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
export const COL = 250;

/** Every page as items: cover, project pages (+ continuations), closing contents page. Images are referenced by index into the
 *  project order of those that have a shot (portfolio images list = projects.filter(shot)). */
export function layoutArchPortfolio(p: ArchPortfolio): Item[][] {
  const { w: W, h: H, m: M } = A4L, T = APF_TEXT[p.lang], projects = p.projects.slice(0, APF_MAX.projects);
  const img = new Map<number, number>();
  projects.forEach((pr, i) => { if (pr.shot) img.set(i, img.size); });
  const dates = projects.map((x) => x.at.slice(0, 10)).filter(Boolean).sort();
  const cover: Item[] = [
    { t: "text", x: M, y: H - M - 70, font: "F2", size: 30, s: pdfWrap(p.title || T.cover, 30, 300)[0] },
    { t: "text", x: M, y: H - M - 98, font: "F1", size: 14, s: p.name },
    { t: "line", x1: M, y1: H - M - 112, x2: M + 240, y2: H - M - 112, lw: 0.6 },
    { t: "text", x: M, y: M + 10, font: "F1", size: 9, s: [`${projects.length} ${T.projects}`, dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`) : ""].filter(Boolean).join(" · ") },
  ];
  const heroI = projects.findIndex((x) => x.shot);
  if (heroI >= 0) { const s = projects[heroI].shot!; cover.push({ t: "img", i: img.get(heroI)!, ...fitBox(s.w, s.h, 330, M, W - 330 - M, H - 2 * M) }); }
  else if (projects[0]) cover.push(...planItems(projects[0].scene, { x: 330, y: M, w: W - 330 - M, h: H - 2 * M }, p.lang));

  const pages: Item[][] = [cover], starts: number[] = [];
  projects.forEach((pr, i) => {
    starts.push(pages.length + 1);
    const title = pdfWrap(pr.title || `${T.version} ${i + 1}`, 18, COL).slice(0, 2);
    const head: Item[] = [{ t: "text", x: M, y: H - M - 8, font: "F2", size: 9, s: pad2(i + 1) },
      ...title.map((l, k): Item => ({ t: "text", x: M, y: H - M - 32 - k * 21, font: "F2", size: 18, s: l })),
      { t: "text", x: M, y: H - M - 44 - (title.length - 1) * 21, font: "F1", size: 8, s: `${pr.at.slice(0, 10)} · ${T.version} ${sceneVersion(pr.scene)}` }];
    const top = H - M - 62 - (title.length - 1) * 21;
    const rows: Row[] = [...textRows(pr.brief.slice(0, APF_MAX.brief), "F1", 10, 13, COL), gapRow(10), headRow(T.numbers),
      ...keyNumbers(pr.scene, p.lang).flatMap(([k, v]) => {
        const lv = pdfWrap(v, 8.5, COL - 112);
        return [{ h: lv.length * 11 + 2, draw: (x: number, y: number) => [{ t: "text" as const, x, y: y - 8.5, font: "F1" as const, size: 8.5, s: pdfWrap(k, 8.5, 108)[0] }, ...lv.map((l, j) => ({ t: "text" as const, x: x + 112, y: y - 8.5 - j * 11, font: "F2" as const, size: 8.5, s: l }))] }];
      }),
      ...(pr.crits.length ? [gapRow(10), headRow(T.crit), ...pr.crits.flatMap((c) => [...textRows(c, "F1", 9, 11.5, COL), gapRow(3)])] : [])];
    const right = { x: M + COL + 30, w: W - M - (M + COL + 30) }, planH = pr.shot ? 210 : H - 2 * M;
    const art: Item[] = pr.shot ? [{ t: "img", i: img.get(i)!, ...fitBox(pr.shot.w, pr.shot.h, right.x, M + planH + 12, right.w, H - 2 * M - planH - 12) }] : [];
    art.push(...planItems(pr.scene, { x: right.x, y: M, w: right.w, h: planH }, p.lang));
    const half = (W - 2 * M - 30) / 2, more = (): Frame[] => [{ x: M, top: H - M - 30, bottom: M + 10, w: half }, { x: M + half + 30, top: H - M - 30, bottom: M + 10, w: half }];
    const chunks = flow(rows, [{ x: M, top, bottom: M + 10, w: COL }], more);
    pages.push([...head, ...art, ...chunks[0]]);
    for (let c = 1; c < chunks.length; c += 2)
      pages.push([{ t: "text", x: M, y: H - M - 8, font: "F2", size: 9, s: `${pad2(i + 1)}  ${title[0]} (${T.cont})` }, ...chunks[c], ...(chunks[c + 1] ?? [])]);
  });

  const contents: Item[] = [{ t: "text", x: M, y: H - M - 30, font: "F2", size: 22, s: T.contents }, { t: "line", x1: M, y1: H - M - 44, x2: W - M, y2: H - M - 44, lw: 0.6 }];
  projects.forEach((pr, i) => {
    const y = H - M - 72 - i * 20;
    contents.push({ t: "text", x: M, y, font: "F2", size: 10, s: pad2(i + 1) }, { t: "text", x: M + 30, y, font: "F1", size: 10, s: pdfWrap(pr.title || `${T.version} ${i + 1}`, 10, 380)[0] },
      { t: "text", x: M + 430, y, font: "F1", size: 9, s: pr.at.slice(0, 10) }, { t: "text", x: W - M - 30, y, font: "F1", size: 10, s: String(starts[i]) });
  });
  contents.push({ t: "text", x: M, y: M + 10, font: "F3", size: 8, s: T.sunNote });
  pages.push(contents);
  const footer = [p.name, p.title || T.cover].filter(Boolean).join(" · ");
  pages.forEach((pg, i) => { if (i) pg.push({ t: "text", x: W - M - 160, y: 18, font: "F1", size: 7, s: `${footer.slice(0, 50)}  ${i + 1}/${pages.length}` }); });
  return pages;
}

const op = (it: Item): string => {
  if (it.t === "text") return pdfText(it.x, it.y, it.font, it.size, it.s);
  if (it.t === "img") return pdfImage(it.i, it.x, it.y, it.w, it.h);
  if (it.t === "line") return `${it.lw} w ${it.x1.toFixed(1)} ${it.y1.toFixed(1)} m ${it.x2.toFixed(1)} ${it.y2.toFixed(1)} l S`;
  const re = `${it.x.toFixed(1)} ${it.y.toFixed(1)} ${it.w.toFixed(1)} ${it.h.toFixed(1)} re`;
  return it.fill !== undefined ? `${it.lw} w ${it.fill} g ${re} ${it.lw ? "B" : "f"} 0 g` : `${it.lw} w ${re} S`; // state ops before the path, never inside it
};

export function archPortfolioPdf(p: ArchPortfolio): Uint8Array {
  const pages: PdfPage[] = layoutArchPortfolio(p).map((items) => ({ ops: items.map(op) }));
  return pdfDoc(pages, A4L, p.title || APF_TEXT[p.lang].cover, p.projects.slice(0, APF_MAX.projects).flatMap((x) => (x.shot ? [x.shot] : [])));
}
