// ARCH → IFC4 export (pure, tested in tests/arch-ifc.test.ts). The scene's blocks become an IFC4 STEP file a BIM viewer can open:
// project → site → building → one storey per slab level, every part an extruded box (a gable roof is an extruded triangle).
// A floor's outer shell is written as four walls; each window/door gets an IfcOpeningElement that voids its wall.
// Axes: ARCH +x east, +y up, −z north → IFC X = x, Y = −z (north), Z = y. Lengths in metres.
import { isStraightWall, OPENING, RULES, type Face, type Part, type Scene } from "./arch-pure.ts";

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** 16 bytes → the 22-character IFC GlobalId (1 char for the top 2 bits of byte 0's group, then 3 bytes → 4 chars). */
export function compressGuid(bytes: number[]): string {
  const enc = (v: number, n: number) => Array.from({ length: n }, (_, i) => B64[Math.floor(v / 64 ** (n - 1 - i)) % 64]).join("");
  let s = enc(bytes[0], 2);
  for (let i = 1; i < 16; i += 3) s += enc((bytes[i] << 16) + (bytes[i + 1] << 8) + bytes[i + 2], 4);
  return s;
}
export function expandGuid(g: string): number[] {
  const dec = (s: string) => [...s].reduce((v, c) => v * 64 + B64.indexOf(c), 0), out = [dec(g.slice(0, 2))];
  for (let i = 2; i < 22; i += 4) { const v = dec(g.slice(i, i + 4)); out.push((v >> 16) & 255, (v >> 8) & 255, v & 255); }
  return out;
}
/** cyrb128: a stable 128-bit hash, so re-exporting the same part gives the same GlobalId (BIM tools can diff versions). */
function hash16(s: string): number[] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067); h2 = h3 ^ Math.imul(h2 ^ k, 2869860233); h3 = h4 ^ Math.imul(h3 ^ k, 951274213); h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067); h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233); h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213); h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1, h2, h3, h4].flatMap((h) => [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255]);
}
export const ifcGuid = (key: string) => compressGuid(hash16(key));

/** STEP real: always has a decimal point ("3." not "3"), no exponent. */
export const real = (n: number) => { const v = Math.round(n * 1e6) / 1e6 || 0, s = String(v); return s.includes("e") ? v.toFixed(6) : s.includes(".") ? s : `${s}.`; };
/** STEP string: quotes doubled, backslash doubled, anything outside printable ASCII as \X2\hhhh\X0\ (UTF-16). */
export const str = (s: string) => `'${s.replace(/[^\x20-\x7e]+|['\\]/g, (m) => (m === "'" ? "''" : m === "\\" ? "\\\\"
  : `\\X2\\${m.split("").map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("")}\\X0\\`))}'`;

const SIDES = [["n", "north"], ["e", "east"], ["s", "south"], ["w", "west"]] as const;
type Box = { x: number; y: number; z: number; w: number; d: number; h: number }; // ARCH coordinates, centre of footprint, y = bottom

/** A wall part → the wall boxes IFC gets: a straight wall is itself; a shell is four strips (n/s full length, e/w between). */
export function wallPieces(p: Part): { face?: Face; side?: string; box: Box }[] {
  if (isStraightWall(p)) return [{ box: p }];
  const T = RULES.wallThick, x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2, mz = p.d - 2 * T;
  const box: Record<Face, Box> = {
    n: { x: p.x, y: p.y, z: z0 + T / 2, w: p.w, d: T, h: p.h }, s: { x: p.x, y: p.y, z: z1 - T / 2, w: p.w, d: T, h: p.h },
    e: { x: x1 - T / 2, y: p.y, z: p.z, w: T, d: mz, h: p.h }, w: { x: x0 + T / 2, y: p.y, z: p.z, w: T, d: mz, h: p.h },
  };
  return SIDES.map(([face, side]) => ({ face, side, box: box[face] }));
}

/** site.north: true north's bearing in degrees clockwise from model −Z (= IFC +Y) seen from above, as arch-site-pure's Site.north. */
export type IfcOptions = { name?: string; site?: { lat: number; lon: number; north?: number }; time?: Date; seed?: string };

/** Scene → IFC4 STEP text. Openings whose host wall is missing are skipped. */
export function toIfc(scene: Scene, opt: IfcOptions = {}): string {
  const name = opt.name ?? "ARCH study model", seed = opt.seed ?? "orbit-arch", out: string[] = [];
  const add = (e: string) => { out.push(`#${out.length + 1}=${e};`); return `#${out.length}`; };
  const guid = (key: string) => str(ifcGuid(`${seed}:${key}`));
  const pt3 = (x: number, y: number, z: number) => add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const dir = (...v: number[]) => add(`IFCDIRECTION((${v.map(real).join(",")}))`);
  const origin = pt3(0, 0, 0), zUp = dir(0, 0, 1), world = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
  const place = (rel: string | null, x: number, y: number, z: number) => add(`IFCLOCALPLACEMENT(${rel ?? "$"},${add(`IFCAXIS2PLACEMENT3D(${pt3(x, y, z)},$,$)`)})`);

  // TrueNorth: the direction of true north in the model's XY plane; omitted when north is model +Y (the IFC default)
  const n = ((opt.site?.north ?? 0) * Math.PI) / 180, trueNorth = opt.site?.north ? dir(Math.sin(n), Math.cos(n)) : "$";
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},${trueNorth})`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = ["LENGTHUNIT.,$,.METRE", "AREAUNIT.,$,.SQUARE_METRE", "VOLUMEUNIT.,$,.CUBIC_METRE", "PLANEANGLEUNIT.,$,.RADIAN"].map((u) => add(`IFCSIUNIT(*,.${u}.)`));
  const project = add(`IFCPROJECT(${guid("project")},$,${str(name)},$,$,$,$,(${ctx}),${add(`IFCUNITASSIGNMENT((${units.join(",")}))`)})`);

  const dms = (deg: number) => { const s = Math.sign(deg) || 1, a = Math.abs(deg), d = Math.floor(a), m = Math.floor((a - d) * 60), sec = Math.floor(((a - d) * 60 - m) * 60), mu = Math.round(((((a - d) * 60 - m) * 60) - sec) * 1e6);
    return `(${[d, m, sec, mu].map((v) => s * v || 0).join(",")})`; };
  const sitePl = place(null, 0, 0, 0), bldPl = place(sitePl, 0, 0, 0);
  const site = add(`IFCSITE(${guid("site")},$,'Site',$,$,${sitePl},$,$,.ELEMENT.,${opt.site ? `${dms(opt.site.lat)},${dms(opt.site.lon)}` : "$,$"},0.,$,$)`);
  const building = add(`IFCBUILDING(${guid("building")},$,${str(name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES(${guid("rel:project")},$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES(${guid("rel:site")},$,$,$,${site},(${building}))`);

  // storeys: one per slab level (walls' levels when there are no slabs); a part belongs to the highest level at or below its base
  const solid = scene.parts.filter((p) => p.kind !== "window" && p.kind !== "door");
  const lv = (ps: Part[]) => [...new Set(ps.map((p) => Math.round(p.y * 10) / 10))].sort((a, b) => a - b);
  let levels = lv(solid.filter((p) => p.kind === "slab"));
  if (!levels.length) levels = lv(solid.filter((p) => p.kind === "wall"));
  if (!levels.length) levels = [0];
  const levelOf = (y: number) => levels.reduce((k, l, i) => (l <= y + 0.05 ? i : k), 0);
  const storeys = levels.map((elev, i) => {
    const pl = place(bldPl, 0, 0, elev);
    return { elev, pl, id: add(`IFCBUILDINGSTOREY(${guid(`storey:${i}`)},$,${str(`Floor ${i + 1}`)},$,$,${pl},$,$,.ELEMENT.,${real(elev)})`), items: [] as string[] };
  });
  add(`IFCRELAGGREGATES(${guid("rel:building")},$,$,$,${building},(${storeys.map((s) => s.id).join(",")}))`);

  const shape = (solidRef: string) => add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solidRef}))`)}))`);
  /** A box as an extruded rectangle, placed at its footprint centre on its storey. */
  const boxRep = (b: Box) => shape(add(`IFCEXTRUDEDAREASOLID(${add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${add("IFCCARTESIANPOINT((0.,0.))")},$)`)},${real(b.w)},${real(b.d)})`)},${world},${zUp},${real(b.h)})`));
  /** Gable roof, ridge along x: a triangle in the Y–Z plane extruded along X (matches the 3D view; under 0.5 m it is flat). */
  const gableRep = (b: Box) => {
    const pts = [[-b.d / 2, 0], [b.d / 2, 0], [0, b.h], [-b.d / 2, 0]].map(([u, v]) => add(`IFCCARTESIANPOINT((${real(u)},${real(v)}))`));
    const prof = add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${add(`IFCPOLYLINE((${pts.join(",")}))`)})`);
    const pos = add(`IFCAXIS2PLACEMENT3D(${pt3(-b.w / 2, 0, 0)},${dir(1, 0, 0)},${dir(0, 1, 0)})`);
    return shape(add(`IFCEXTRUDEDAREASOLID(${prof},${pos},${zUp},${real(b.w)})`));
  };
  const element = (key: string, b: Box, make: (g: string, pl: string, rep: string) => string, contained = true, rep = boxRep) => {
    const s = storeys[levelOf(b.y)], pl = place(s.pl, b.x, -b.z, b.y - s.elev), id = add(make(guid(key), pl, rep(b)));
    if (contained) s.items.push(id);
    return id;
  };
  const head = (g: string, nm: string, pl: string, rep: string) => `${g},$,${str(nm)},$,$,${pl},${rep},$`;

  const wallIds = new Map<string, { face?: Face; id: string; box: Box }[]>();
  for (const p of solid) {
    if (p.kind === "wall") {
      wallIds.set(p.id, wallPieces(p).map(({ face, side, box }) => ({ face, box, id: element(`${p.id}${side ? `:${side}` : ""}`, box, (g, pl, rep) => `IFCWALL(${head(g, side ? `${p.name} · ${side}` : p.name, pl, rep)},.STANDARD.)`) })));
    } else if (p.kind === "slab") element(p.id, p, (g, pl, rep) => `IFCSLAB(${head(g, p.name, pl, rep)},.FLOOR.)`);
    else if (p.kind === "foundation") element(p.id, p, (g, pl, rep) => `IFCFOOTING(${head(g, p.name, pl, rep)},.STRIP_FOOTING.)`);
    else if (p.kind === "stair") element(p.id, p, (g, pl, rep) => `IFCSTAIR(${head(g, p.name, pl, rep)},.NOTDEFINED.)`);
    else if (p.kind === "roof") { const flat = p.h < 0.5; element(p.id, p, (g, pl, rep) => `IFCROOF(${head(g, p.name, pl, rep)},${flat ? ".FLAT_ROOF." : ".GABLE_ROOF."})`, true, flat ? boxRep : gableRep); }
  }
  for (const o of scene.parts) {
    if ((o.kind !== "window" && o.kind !== "door") || !o.host || !o.face) continue;
    const pieces = wallIds.get(o.host), host = pieces?.find((q) => !q.face || q.face === o.face);
    if (!host) continue;
    const ns = o.face === "n" || o.face === "s", t = Math.min(host.box.w, host.box.d);
    const at = (depth: number): Box => ({ x: ns ? o.x : host.box.x, z: ns ? host.box.z : o.z, y: o.y, h: o.h, w: ns ? o.w : depth, d: ns ? depth : o.w }); // centred in the wall
    const void_ = element(`${o.id}:opening`, at(t + 0.1), (g, pl, rep) => `IFCOPENINGELEMENT(${head(g, `Opening for ${o.name}`, pl, rep)},.OPENING.)`, false);
    add(`IFCRELVOIDSELEMENT(${guid(`${o.id}:voids`)},$,$,$,${host.id},${void_})`);
    const fill = element(o.id, at(OPENING.depth), (g, pl, rep) => o.kind === "window"
      ? `IFCWINDOW(${head(g, o.name, pl, rep)},${real(o.h)},${real(o.w)},.WINDOW.,.SINGLE_PANEL.,$)`
      : `IFCDOOR(${head(g, o.name, pl, rep)},${real(o.h)},${real(o.w)},.DOOR.,.SINGLE_SWING_LEFT.,$)`);
    add(`IFCRELFILLSELEMENT(${guid(`${o.id}:fills`)},$,$,$,${void_},${fill})`);
  }
  storeys.forEach((s, i) => { if (s.items.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid(`rel:storey:${i}`)},$,$,$,(${s.items.join(",")}),${s.id})`); });

  const time = (opt.time ?? new Date()).toISOString().slice(0, 19);
  return ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');",
    `FILE_NAME(${str(`${name}.ifc`)},'${time}',(''),(''),'ORBIT ARCH','ORBIT ARCH IFC export','');`, "FILE_SCHEMA(('IFC4'));", "ENDSEC;",
    "DATA;", ...out, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
