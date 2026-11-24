// "Planet Earth" city close-ups: a crisp vector ground under the OSM buildings. The 10 m Sentinel-2 imagery turns to blur below
// ~8 km, so each z14 tile gets a map drawn from OpenStreetMap instead: sea (built from the coastline), lakes and rivers, parks,
// forest and land use, roads by class (real widths, the big ones softly glowing), railways. Pure: the Overpass query (one call
// per tile, buildings included), parsing into tile-local shapes, coastline → sea polygons, and the drawing onto any 2D canvas.
// Tests: tests/earth-ground.test.ts. Data: © OpenStreetMap contributors, ODbL (fetched on the laptop server, cached on disk).
import { lat2y, lon2x, type Box } from "./earth-pure.ts";
import { BZ, capBuildings, parseOverpass, type Building } from "./earth-buildings-pure.ts";

/** Tile-local coordinates: 0…EXT across one z14 tile, y down (like a vector tile), whole numbers (≈0.3 m at Tallinn). */
export const EXT = 4096;
/** The vector ground shows below this altitude (km) and is fully in from GROUND_FULL down. */
export const GROUND_MAX_ALT = 12, GROUND_FULL = 6;
/** Canvas size per tile (px) and how many tiles may be live: 1024² ≈ 1.2 m/px, ~5.6 MB with mipmaps, 25 tiles ≈ 140 MB VRAM. */
export const GROUND_PX = 1024, GROUND_TILES = 25;

export type Pt = [number, number];
export type LandClass = "park" | "forest" | "grass" | "residential" | "industrial" | "commercial" | "farmland" | "cemetery" | "sand" | "pitch";
export type RoadClass = "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "street" | "service" | "path";
export type Ground = {
  /** lakes, rivers, docks: filled and edged */
  water: Pt[][];
  /** the sea built from the coastline (even-odd, so islands stay land); no edge line, so tile borders never show */
  sea: Pt[][];
  /** no coastline and nothing mapped: the scene decides sea or land from the elevation (open sea vs an unmapped field) */
  open?: true;
  land: { c: LandClass; r: Pt[][] }[];
  /** rivers and streams too thin to be polygons: [width in metres, line] */
  streams: { w: number; l: Pt[] }[];
  roads: { c: RoadClass; l: Pt[]; bridge?: true; tunnel?: true }[];
  rail: Pt[][];
  coast: Pt[][];
};

/** One Overpass call per tile: the buildings and everything the ground needs. Coastline ways come whole (the sea is clipped here). */
export function groundQuery(b: Box): string {
  const f = (n: number) => n.toFixed(6), bb = `(${f(b.s)},${f(b.w)},${f(b.n)},${f(b.e)})`;
  return `[out:json][timeout:25];(way["building"]${bb};way["highway"]${bb};way["railway"~"^(rail|tram|light_rail|subway|narrow_gauge)$"]${bb};` +
    `way["natural"~"^(water|wood|coastline|scrub|sand|beach|wetland|grassland)$"]${bb};way["waterway"]${bb};way["landuse"]${bb};way["leisure"~"^(park|garden|pitch|playground|golf_course)$"]${bb};` +
    `relation["type"="multipolygon"]["natural"~"^(water|wood)$"]${bb};relation["type"="multipolygon"]["landuse"]${bb};relation["type"="multipolygon"]["leisure"="park"]${bb};relation["type"="multipolygon"]["waterway"="riverbank"]${bb};);out tags geom;`;
}

/** Road widths in metres (the drawn carriageway) and their draw order (small first). */
export const ROAD_W: Record<RoadClass, number> = { motorway: 22, trunk: 18, primary: 15, secondary: 12, tertiary: 10, street: 7, service: 4, path: 2 };
export const ROAD_ORDER: RoadClass[] = ["path", "service", "street", "tertiary", "secondary", "primary", "trunk", "motorway"];
export function roadClass(t: Record<string, string>): RoadClass | null {
  const h = (t.highway ?? "").replace(/_link$/, "");
  if (t.area === "yes" || ["proposed", "construction", "abandoned", "platform", "bus_stop", "elevator", "steps", "corridor", "raceway"].includes(h)) return h === "steps" ? "path" : null;
  if (["motorway", "trunk", "primary", "secondary", "tertiary"].includes(h)) return h as RoadClass;
  if (["residential", "unclassified", "living_street", "pedestrian", "road", "busway"].includes(h)) return "street";
  if (h === "service" || h === "track") return "service";
  if (["footway", "cycleway", "path", "bridleway"].includes(h)) return "path";
  return null;
}
export function landClass(t: Record<string, string>): LandClass | null {
  const lu = t.landuse, n = t.natural, le = t.leisure;
  if (le === "park" || le === "garden" || le === "golf_course" || lu === "recreation_ground" || lu === "village_green") return "park";
  if (le === "pitch" || le === "playground") return "pitch";
  if (n === "wood" || lu === "forest" || n === "scrub" || n === "wetland") return "forest";
  if (lu === "grass" || lu === "meadow" || n === "grassland" || lu === "allotments") return "grass";
  if (lu === "cemetery") return "cemetery";
  if (n === "sand" || n === "beach") return "sand";
  if (lu === "farmland" || lu === "orchard") return "farmland";
  if (lu === "residential") return "residential";
  if (lu === "industrial" || lu === "railway" || lu === "port" || lu === "construction" || lu === "brownfield" || lu === "garages") return "industrial";
  if (lu === "commercial" || lu === "retail") return "commercial";
  return null;
}
const isWaterArea = (t: Record<string, string>) => t.natural === "water" || t.waterway === "riverbank" || t.waterway === "dock" || t.landuse === "reservoir" || t.landuse === "basin";

/** lon/lat → tile-local point (whole numbers). */
export const toTile = (x: number, y: number) => (lon: number, lat: number): Pt => [Math.round((lon2x(lon, BZ) - x) * EXT), Math.round((lat2y(lat, BZ) - y) * EXT)];

const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
/** Joins way pieces that share end points into longer lines (reversing pieces where needed when `free`). */
export function joinLines(ls: Pt[][], free = true): Pt[][] {
  const left = ls.filter((l) => l.length > 1).map((l) => l.slice()), out: Pt[][] = [];
  while (left.length) {
    let cur = left.pop()!, grew = true;
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const l = left[i], a = cur[0], z = cur[cur.length - 1];
        if (same(z, l[0])) cur = cur.concat(l.slice(1));
        else if (same(l[l.length - 1], a)) cur = l.concat(cur.slice(1));
        else if (free && same(z, l[l.length - 1])) cur = cur.concat(l.slice().reverse().slice(1));
        else if (free && same(l[0], a)) cur = l.slice().reverse().concat(cur.slice(1));
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Cuts a line to the square [0, s]², giving the pieces inside; points where a piece crosses the edge lie exactly on it. */
export function clipLine(l: Pt[], s = EXT): Pt[][] {
  const out: Pt[][] = []; let cur: Pt[] | null = null;
  const inside = (p: Pt) => p[0] >= 0 && p[0] <= s && p[1] >= 0 && p[1] <= s;
  for (let i = 0; i + 1 < l.length; i++) {
    const a = l[i], b = l[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0]], [dx, s - a[0]], [-dy, a[1]], [dy, s - a[1]]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
    const snap = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.abs(v - s) < 1e-6 ? s : v);
    const P = (t: number): Pt => [snap(a[0] + dx * t), snap(a[1] + dy * t)];
    if (!cur) cur = [t0 === 0 && inside(a) ? a : P(t0)];
    const e = t1 === 1 ? b : P(t1);
    if (!same(e, cur[cur.length - 1])) cur.push(e);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out.filter((p) => p.length > 1);
}

/** Position along the square's edge, clockwise as seen on screen (y down) from the top-left corner: 0…4, or -1 if not on it. */
export function edgePos(p: Pt, s = EXT): number {
  const [x, y] = p;
  if (y === 0) return x / s;
  if (x === s) return 1 + y / s;
  if (y === s) return 2 + (s - x) / s;
  if (x === 0) return 3 + (s - y) / s;
  return -1;
}

/** The sea inside the tile from coastline pieces (OSM: land on the left, water on the right). Lines that cross the tile are closed
 *  along its edge, clockwise; closed coastline rings (islands) are holes. With no coastline, `allSea` decides. */
export function seaPolygons(coast: Pt[][], allSea: boolean, s = EXT): Pt[][] {
  const box: Pt[] = [[0, 0], [s, 0], [s, s], [0, s]];
  const joined = joinLines(coast, false);
  const rings = joined.filter((l) => l.length > 3 && same(l[0], l[l.length - 1]));
  const pieces = joined.filter((l) => !same(l[0], l[l.length - 1])).flatMap((l) => clipLine(l, s)).filter((p) => edgePos(p[0], s) >= 0 && edgePos(p[p.length - 1], s) >= 0);
  // closed rings: keep those that touch the tile
  const inTile = rings.filter((r) => r.some((p) => p[0] >= 0 && p[0] <= s && p[1] >= 0 && p[1] <= s));
  const out: Pt[][] = [];
  if (!pieces.length) {
    if (inTile.length || allSea) out.push(box);
    return out.concat(inTile);
  }
  const used = new Set<number>();
  const corner = (c: number): Pt => (c === 1 ? [s, 0] : c === 2 ? [s, s] : c === 3 ? [0, s] : [0, 0]);
  for (let start = 0; start < pieces.length; start++) {
    if (used.has(start)) continue;
    const poly: Pt[] = []; let i = start;
    while (!used.has(i)) {
      used.add(i); poly.push(...pieces[i]);
      const tOut = edgePos(pieces[i][pieces[i].length - 1], s);
      // the next piece to start clockwise from where this one leaves (itself, for a single crossing)
      let best = i, bestD = (edgePos(pieces[i][0], s) - tOut + 4) % 4;
      for (let j = 0; j < pieces.length; j++) { const d = (edgePos(pieces[j][0], s) - tOut + 4) % 4; if (d < bestD) { bestD = d; best = j; } }
      for (let c = 1; c <= 4; c++) { const dc = (c - tOut + 4) % 4; if (dc > 0 && dc < bestD) poly.push(corner(c)); }
      // corners in clockwise order from tOut
      const tail = poly.splice(poly.length - [1, 2, 3, 4].filter((c) => { const dc = (c - tOut + 4) % 4; return dc > 0 && dc < bestD; }).length);
      tail.sort((p, q) => (edgePos(p, s) - tOut + 4) % 4 - (edgePos(q, s) - tOut + 4) % 4); poly.push(...tail);
      i = best;
    }
    if (poly.length > 2) out.push(poly);
  }
  return out.concat(inTile);
}

type El = { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[] };
/** Overpass JSON → the tile's ground shapes and its buildings (one response, one parse). */
export function parseGround(j: { elements?: El[] } | null | undefined, x: number, y: number): { ground: Ground; buildings: Building[] } {
  const T = toTile(x, y), els = j?.elements ?? [];
  const g: Ground = { water: [], sea: [], land: [], streams: [], roads: [], rail: [], coast: [] };
  const line = (geo: { lat: number; lon: number }[] | undefined) => (geo ?? []).filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => T(p.lon, p.lat)).filter((p, i, a) => i === 0 || !same(p, a[i - 1]));
  const closed = (l: Pt[]) => l.length > 3 && same(l[0], l[l.length - 1]);
  const coast: Pt[][] = [];
  for (const el of els) {
    const t = el.tags ?? {};
    if (el.type === "way") {
      if (t.building) continue;
      const l = line(el.geometry);
      if (l.length < 2) continue;
      if (t.natural === "coastline") { coast.push(l); continue; }
      if (isWaterArea(t) && closed(l)) g.water.push(l);
      else if (t.waterway && !isWaterArea(t)) { if (["river", "canal", "stream", "ditch", "drain"].includes(t.waterway) && t.tunnel !== "yes" && t.tunnel !== "culvert") g.streams.push({ w: t.waterway === "river" ? 18 : t.waterway === "canal" ? 10 : 3, l }); }
      else if (t.highway) {
        const c = roadClass(t); if (!c || t.tunnel === "yes" && c === "path") continue;
        g.roads.push({ c, l, ...(t.bridge && t.bridge !== "no" ? { bridge: true as const } : {}), ...(t.tunnel && t.tunnel !== "no" ? { tunnel: true as const } : {}) });
      } else if (t.railway) { if (t.tunnel !== "yes") g.rail.push(l); }
      else { const c = landClass(t); if (c && closed(l)) g.land.push({ c, r: [l] }); }
    } else if (el.type === "relation" && el.members) {
      const ways = el.members.filter((m) => m.type === "way" && m.geometry).map((m) => line(m.geometry)).filter((l) => l.length > 1);
      const rings = joinLines(ways).filter(closed);
      if (!rings.length) continue;
      if (isWaterArea(t)) g.water.push(...rings); else { const c = landClass(t); if (c) g.land.push({ c, r: rings }); }
    }
  }
  g.coast = joinLines(coast, false);
  g.sea = seaPolygons(coast, false);
  const empty = !g.water.length && !g.land.length && !g.roads.length && !g.rail.length && !g.streams.length;
  if (!coast.length && empty && !els.some((e) => e.tags?.building)) g.open = true;
  return { ground: g, buildings: capBuildings(parseOverpass(j as never)) };
}

/** An empty tile (`open`) over the sea, by the elevation model: the whole tile becomes sea. */
export function withOpenSea(g: Ground, isSea: boolean): Ground {
  return g.open && isSea && !g.sea.length ? { ...g, sea: [[[0, 0], [EXT, 0], [EXT, EXT], [0, EXT]]] } : g;
}

/* ---------- drawing (any CanvasRenderingContext2D-like target) ---------- */

/** The dark futuristic palette: near-black land, deep blue water, muted green parks, cool roads; the major roads glow. */
export const STYLE = {
  land: "#0b0f15",
  water: "#06182c", waterEdge: "#2b6fa3", coast: "#3f8fd0",
  landuse: { park: "#0d2218", forest: "#0b1d15", grass: "#0e1f17", pitch: "#10261c", cemetery: "#0e1b16", sand: "#1b1a16", farmland: "#10140f", residential: "#0e131a", industrial: "#121319", commercial: "#13141d" } as Record<LandClass, string>,
  road: { motorway: "#9ec9ff", trunk: "#8fbef5", primary: "#86b4ea", secondary: "#6f93bd", tertiary: "#5a7697", street: "#3c4b5e", service: "#2b3542", path: "#2a3340" } as Record<RoadClass, string>,
  casing: "#05070b", glow: "#3d8cff", rail: "#7d8aa0",
};
/** Which roads glow, and how strongly (0…1). */
export const GLOW: Partial<Record<RoadClass, number>> = { motorway: 1, trunk: 0.9, primary: 0.8, secondary: 0.45 };

export type Ctx = {
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineCap: string; lineJoin: string; globalAlpha: number; shadowBlur: number; shadowColor: string;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void;
  fill(rule?: "evenodd" | "nonzero"): void; stroke(): void; fillRect(x: number, y: number, w: number, h: number): void; setLineDash(d: number[]): void;
};
/** Metres per tile-local unit at a latitude (z14 tiles shrink with cos(lat)). */
export const metresPerUnit = (lat: number) => (40075016.7 * Math.cos((lat * Math.PI) / 180)) / 2 ** BZ / EXT;

/** Draws a tile's ground onto a size×size canvas. lat: the tile's latitude (for real road widths). Returns the number of shapes drawn. */
export function drawGround(c: Ctx, g: Ground, size: number, lat: number): number {
  const k = size / EXT, px = (m: number) => m / metresPerUnit(lat) * k; // metres → canvas px
  let n = 0;
  const path = (ls: Pt[][], close: boolean) => { c.beginPath(); for (const l of ls) { c.moveTo(l[0][0] * k, l[0][1] * k); for (let i = 1; i < l.length; i++) c.lineTo(l[i][0] * k, l[i][1] * k); if (close) c.closePath(); } n += ls.length; };
  c.globalAlpha = 1; c.shadowBlur = 0; c.setLineDash([]); c.lineCap = "round"; c.lineJoin = "round";
  c.fillStyle = STYLE.land; c.fillRect(0, 0, size, size);
  // land use: wide classes first, parks and woods on top
  const order: LandClass[] = ["farmland", "residential", "commercial", "industrial", "grass", "cemetery", "sand", "forest", "park", "pitch"];
  for (const cls of order) { const rs = g.land.filter((x) => x.c === cls).flatMap((x) => x.r); if (!rs.length) continue; c.fillStyle = STYLE.landuse[cls]; path(rs, true); c.fill("evenodd"); }
  // sea and lakes; lakes get a fine bright edge (the sea's edge is the coastline)
  if (g.sea?.length) { c.fillStyle = STYLE.water; path(g.sea, true); c.fill("evenodd"); }
  if (g.water.length) { c.fillStyle = STYLE.water; path(g.water, true); c.fill("evenodd"); c.strokeStyle = STYLE.waterEdge; c.lineWidth = Math.max(1, px(1.2)); c.globalAlpha = 0.5; c.stroke(); c.globalAlpha = 1; }
  for (const s of g.streams) { c.strokeStyle = STYLE.water; c.lineWidth = Math.max(1, px(s.w)); path([s.l], false); c.stroke(); }
  if (g.coast.length) { c.strokeStyle = STYLE.coast; c.lineWidth = Math.max(1, px(2)); c.globalAlpha = 0.75; path(g.coast, false); c.stroke(); c.globalAlpha = 1; }
  // railways: a thin line with sleepers
  if (g.rail.length) { c.strokeStyle = STYLE.rail; c.globalAlpha = 0.55; c.lineWidth = Math.max(1, px(1.6)); path(g.rail, false); c.stroke(); c.setLineDash([px(1.2), px(3.5)]); c.lineWidth = Math.max(1.5, px(4.5)); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; }
  // roads: tunnels faint, then dark casings, the soft glow of the major roads, then the fills (small → big)
  const live = g.roads.filter((r) => !r.tunnel);
  for (const r of g.roads.filter((r) => r.tunnel)) { c.strokeStyle = STYLE.road[r.c]; c.globalAlpha = 0.18; c.lineWidth = Math.max(1, px(ROAD_W[r.c])); path([r.l], false); c.stroke(); }
  c.globalAlpha = 1;
  for (const cls of ROAD_ORDER) {
    const ls = live.filter((r) => r.c === cls).map((r) => r.l); if (!ls.length || cls === "path") continue;
    c.strokeStyle = STYLE.casing; c.lineWidth = Math.max(1.5, px(ROAD_W[cls] + 3)); path(ls, false); c.stroke();
  }
  for (const cls of ROAD_ORDER) {
    const ls = live.filter((r) => r.c === cls).map((r) => r.l), gl = GLOW[cls]; if (!ls.length || !gl) continue;
    c.strokeStyle = STYLE.glow; c.globalAlpha = 0.22 * gl; c.lineWidth = px(ROAD_W[cls] * 2.4); path(ls, false); c.stroke();
    c.globalAlpha = 0.3 * gl; c.lineWidth = px(ROAD_W[cls] * 1.4); c.stroke();
  }
  c.globalAlpha = 1;
  for (const cls of ROAD_ORDER) {
    const ls = live.filter((r) => r.c === cls).map((r) => r.l); if (!ls.length) continue;
    c.strokeStyle = STYLE.road[cls]; c.globalAlpha = cls === "path" ? 0.5 : 1;
    if (cls === "path") c.setLineDash([px(3), px(2.5)]);
    c.lineWidth = Math.max(cls === "path" ? 0.8 : 1, px(ROAD_W[cls] * (GLOW[cls] ? 0.55 : 0.75))); path(ls, false); c.stroke(); c.setLineDash([]);
  }
  c.globalAlpha = 1;
  return n;
}

/** How much of the vector ground shows at an altitude (km): 0 above GROUND_MAX_ALT, 1 from GROUND_FULL down. */
export function groundFade(alt: number): number {
  if (alt >= GROUND_MAX_ALT) return 0;
  if (alt <= GROUND_FULL) return 1;
  const t = Math.log(GROUND_MAX_ALT / alt) / Math.log(GROUND_MAX_ALT / GROUND_FULL);
  return t * t * (3 - 2 * t);
}
