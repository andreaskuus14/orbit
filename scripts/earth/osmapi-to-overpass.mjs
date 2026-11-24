// Dev helper: OSM API /map.json downloads (one per z14 tile) → the Overpass "out tags geom" shape the ground parser reads.
// node scripts/earth/osmapi-to-overpass.mjs out.json in1.json [in2.json …]   (merges and dedupes; © OpenStreetMap contributors, ODbL)
import { readFileSync, writeFileSync } from "node:fs";
const [out, ...ins] = process.argv.slice(2);
const nodes = new Map(), ways = new Map(), rels = new Map();
for (const f of ins) for (const e of JSON.parse(readFileSync(f, "utf8")).elements) (e.type === "node" ? nodes : e.type === "way" ? ways : rels).set(e.id, e);
const geo = (w) => w.nodes.map((n) => nodes.get(n)).filter(Boolean).map((n) => ({ lat: n.lat, lon: n.lon }));
const keep = (t = {}) => t.building || t.highway || t.railway || t.natural || t.waterway || t.landuse || t.leisure;
const els = [];
for (const w of ways.values()) if (keep(w.tags)) { const g = geo(w); if (g.length === w.nodes.length) els.push({ type: "way", tags: w.tags, geometry: g }); }
for (const r of rels.values()) if (r.tags?.type === "multipolygon" && keep(r.tags)) {
  const members = r.members.filter((m) => m.type === "way" && ways.has(m.ref)).map((m) => ({ type: "way", role: m.role, geometry: geo(ways.get(m.ref)) }));
  if (members.length) els.push({ type: "relation", tags: r.tags, members });
}
writeFileSync(out, JSON.stringify({ note: "OSM API map calls, converted to Overpass 'out tags geom'. © OpenStreetMap contributors, ODbL.", elements: els }));
console.log(out, els.length);
