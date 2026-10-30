// ARCH export checks (ARC07): every export is produced, then read back with a parser and compared with the model before it is offered
// as "ready". Formats: bill of quantities CSV, scene JSON, IFC4 STEP. Pure: no DOM.
import { boqCsv, MAX, type costLines, type Part, type Scene } from "./arch-pure.ts";
import { ifcGuid, toIfc, wallPieces } from "./arch-ifc-pure.ts";

export type Check = { name: string; ok: boolean; detail?: string };
export type ExportResult = { format: "csv" | "json" | "ifc"; file: string; type: string; text: string; checks: Check[]; ok: boolean };
const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

/** What each format can not carry; shown under the export buttons. */
export const EXPORT_LIMITS = {
  csv: "Quantities and prices only, no geometry. Units are in the Unit column; EUR, VAT excluded.",
  json: "ORBIT's own scene format (metres, +x east, +y up, −z north). Other programs can't open it; it is for backup and re-import.",
  ifc: "IFC4, metres. Every part is a box (gable roof: extruded triangle); no materials, layers, rooms or property sets. Openings without a host wall are left out.",
};

// ---- CSV ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
export function checkCsv(text: string, c: ReturnType<typeof costLines>): Check[] {
  const rows = parseCsv(text), head = rows[0] ?? [], body = rows.slice(1, -1), total = rows[rows.length - 1] ?? [];
  const lineOk = c.lines.every((l, i) => body[i]?.[0] === l.label && near(Number(body[i][1]), l.qty) && near(Number(body[i][3]), l.buy) && body[i][4] === l.unit
    && (l.total === null ? body[i][6] === "unknown" : Number(body[i][6]) === l.total));
  return [
    { name: "columns", ok: head.length === 11 && rows.every((r) => r.length === head.length), detail: `${head.length} columns` },
    { name: "rows", ok: body.length === c.lines.length, detail: `${body.length}/${c.lines.length}` },
    { name: "quantities + units", ok: lineOk },
    { name: "total", ok: Number(total[6]) === c.total && (c.unknown.length === 0) === !/unknown/.test(total[0] ?? ""), detail: `${c.total} EUR, ${c.unknown.length} unknown` },
  ];
}

// ---- JSON ----
export function checkJson(text: string, scene: Scene): Check[] {
  let back: Scene | null = null;
  try { back = JSON.parse(text); } catch { /* below */ }
  const parts = back?.parts ?? [];
  const sane = (p: Part) => [p.x, p.y, p.z, p.w, p.d, p.h].every(Number.isFinite) && p.w > 0 && p.d > 0 && p.h > 0 && p.w <= MAX.size && p.d <= MAX.size && p.h <= MAX.size;
  return [
    { name: "parses", ok: !!back && Array.isArray(back.parts) },
    { name: "same model", ok: !!back && JSON.stringify(back) === JSON.stringify(scene), detail: `${parts.length} parts` },
    { name: "dimensions in range (m)", ok: parts.every(sane) },
  ];
}

// ---- IFC (STEP) ----
export type Arg = string | Arg[];
export type Ent = { type: string; args: Arg[] };
/** STEP DATA section → id → entity, args as nested lists of raw tokens ('str', #ref, 1.5, $, *, .ENUM.). Throws on a malformed line. */
export function parseStep(text: string): { header: string; ents: Map<string, Ent> } {
  const d0 = text.indexOf("DATA;"), d1 = text.lastIndexOf("ENDSEC;");
  if (!text.startsWith("ISO-10303-21;") || d0 < 0 || d1 < d0 || !text.trimEnd().endsWith("END-ISO-10303-21;")) throw new Error("not a STEP file");
  const ents = new Map<string, Ent>();
  for (const line of text.slice(d0 + 5, d1).split("\n").filter((l) => l.trim())) {
    const m = /^(#\d+)=([A-Z0-9]+)\((.*)\);$/.exec(line);
    if (!m || ents.has(m[1])) throw new Error(`bad entity ${line.slice(0, 40)}`);
    const stack: Arg[][] = [[]]; let cur = "", q = false;
    const flush = () => { if (cur) stack[stack.length - 1].push(cur.trim()); cur = ""; };
    for (let i = 0; i < m[3].length; i++) {
      const c = m[3][i];
      if (q) { cur += c; if (c === "'") { if (m[3][i + 1] === "'") { cur += "'"; i++; } else q = false; } continue; }
      if (c === "'") { q = true; cur += c; } else if (c === "(") { const l: Arg[] = []; stack[stack.length - 1].push(l); stack.push(l); }
      else if (c === ")") { flush(); stack.pop(); if (!stack.length) throw new Error("unbalanced"); } else if (c === ",") flush(); else cur += c;
    }
    flush();
    if (q || stack.length !== 1) throw new Error(`unbalanced ${m[1]}`);
    ents.set(m[1], { type: m[2], args: stack[0] });
  }
  return { header: text.slice(0, d0), ents };
}

type Box = { x: number; y: number; z: number; w: number; d: number; h: number };
/** Expected IFC elements, keyed by the same GlobalId toIfc writes. */
function expected(scene: Scene, seed: string) {
  const out = new Map<string, { type: string; box: Box; gable?: boolean }>(), g = (k: string) => `'${ifcGuid(`${seed}:${k}`)}'`;
  const T: Partial<Record<Part["kind"], string>> = { slab: "IFCSLAB", foundation: "IFCFOOTING", stair: "IFCSTAIR", roof: "IFCROOF" };
  for (const p of scene.parts) {
    if (p.kind === "wall") for (const { side, box } of wallPieces(p)) out.set(g(`${p.id}${side ? `:${side}` : ""}`), { type: "IFCWALL", box });
    else if (T[p.kind]) out.set(g(p.id), { type: T[p.kind]!, box: p, gable: p.kind === "roof" && p.h >= 0.5 });
  }
  for (const o of scene.parts) if ((o.kind === "window" || o.kind === "door") && o.host && o.face && scene.parts.some((w) => w.id === o.host && w.kind === "wall"))
    out.set(g(o.id), { type: o.kind === "window" ? "IFCWINDOW" : "IFCDOOR", box: o });
  return out;
}
const dms = (a: Arg) => (Array.isArray(a) ? a.map(Number) : []).reduce((s, v, i) => s + v / [1, 60, 3600, 3.6e9][i], 0);

export function checkIfc(text: string, scene: Scene, opt: { site?: { lat: number; lon: number }; seed?: string } = {}): Check[] {
  let parsed: ReturnType<typeof parseStep>;
  try { parsed = parseStep(text); } catch (e) { return [{ name: "parses", ok: false, detail: (e as Error).message }]; }
  const { header, ents } = parsed, of = (t: string) => [...ents.values()].filter((e) => e.type === t);
  const ref = (a: Arg | undefined) => (typeof a === "string" ? ents.get(a) : undefined);
  const pt = (a: Arg | undefined) => { const p = ref(a); return p?.type === "IFCCARTESIANPOINT" && Array.isArray(p.args[0]) ? p.args[0].map(Number) : [NaN, NaN, NaN]; };
  /** Absolute position of a local placement: sum the chain (ORBIT writes no rotations on element placements). */
  const abs = (a: Arg | undefined): number[] => {
    const lp = ref(a); if (lp?.type !== "IFCLOCALPLACEMENT") return [0, 0, 0];
    const own = pt(ref(lp.args[1])?.args[0]), up = abs(lp.args[0]);
    return own.map((v, i) => v + up[i]);
  };
  const exp = expected(scene, opt.seed ?? "orbit-arch"), checks: Check[] = [{ name: "parses", ok: true, detail: `${ents.size} entities` }];
  checks.push({ name: "schema IFC4 + header", ok: /FILE_SCHEMA\(\('IFC4'\)\)/.test(header) && /FILE_NAME\(/.test(header) });
  const len = of("IFCSIUNIT").find((u) => u.args[1] === ".LENGTHUNIT.");
  checks.push({ name: "units: metres (scale 1)", ok: !!len && len.args[2] === "$" && len.args[3] === ".METRE.", detail: len ? `${len.args[2]} ${len.args[3]}` : "missing" });
  const proj = of("IFCPROJECT")[0], site = of("IFCSITE")[0];
  const siteOk = !opt.site || (!!site && near(dms(site.args[9]), opt.site.lat, 1e-5) && near(dms(site.args[10]), opt.site.lon, 1e-5));
  checks.push({ name: "metadata: project, site lat/lon", ok: !!proj && proj.args[2] !== "$" && siteOk });

  let dimBad = 0, posBad = 0, missing = 0;
  const byGuid = new Map([...ents.values()].filter((e) => typeof e.args[0] === "string" && e.args[0].startsWith("'")).map((e) => [e.args[0] as string, e]));
  for (const [guid, want] of exp) {
    const e = byGuid.get(guid);
    if (!e || e.type !== want.type) { missing++; continue; }
    const shapeRep = ref((ref(e.args[6])?.args[2] as Arg[] | undefined)?.[0]), solid = ref((shapeRep?.args[3] as Arg[] | undefined)?.[0]);
    const prof = ref(solid?.args[0]), depth = Number(solid?.args[3]), b = want.box, isOpen = want.type === "IFCWINDOW" || want.type === "IFCDOOR";
    if (want.gable) { if (!near(depth, b.w)) dimBad++; }
    else if (prof?.type !== "IFCRECTANGLEPROFILEDEF" || !near(depth, b.h) || (isOpen ? !near(Math.max(Number(prof.args[3]), Number(prof.args[4])), b.w) : !(near(Number(prof.args[3]), b.w) && near(Number(prof.args[4]), b.d)))) dimBad++;
    // orientation: IFC X = x (east), Y = −z (north), Z = y (up); openings sit centred in the wall, so only their height is compared
    const p = abs(e.args[5]);
    if (isOpen ? !near(p[2], b.y) : !(near(p[0], b.x) && near(p[1], -b.z) && near(p[2], b.y))) posBad++;
  }
  checks.push({ name: "every element present", ok: missing === 0, detail: `${exp.size - missing}/${exp.size}` });
  checks.push({ name: "dimensions (m)", ok: dimBad === 0, detail: dimBad ? `${dimBad} differ` : undefined });
  checks.push({ name: "orientation + position", ok: posBad === 0, detail: posBad ? `${posBad} differ` : "x east, y north, z up" });
  return checks;
}

/** Produce and check every export the ARCH panel offers. ok = all checks passed: only then is it offered as ready. */
export function buildExports(scene: Scene, cost: ReturnType<typeof costLines>, site: { lat: number; lon: number }, time?: Date): ExportResult[] {
  const csv = boqCsv(cost), json = JSON.stringify(scene, null, 2), ifc = toIfc(scene, { site, time });
  const res = (format: ExportResult["format"], file: string, type: string, text: string, checks: Check[]): ExportResult => ({ format, file, type, text, checks, ok: checks.every((c) => c.ok) });
  return [
    res("csv", "arch-bill-of-quantities.csv", "text/csv", csv, checkCsv(csv, cost)),
    res("json", "arch-scene.json", "application/json", json, checkJson(json, scene)),
    res("ifc", "arch-model.ifc", "application/x-step", ifc, checkIfc(ifc, scene, { site })),
  ];
}
