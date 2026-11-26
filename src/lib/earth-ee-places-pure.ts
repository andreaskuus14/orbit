// Estonia close-up labels (feat/earth-ee-hud): district names and landmarks from OpenStreetMap (ODbL, credited in the view), the
// local news as pins with small cards, and the decluttering that keeps them off each other and off the panels. Pure; tested in
// tests/earth-ee-places.test.ts. Network + cache: earth-ee-places-store.ts. Drawing: components/earth/earth-ee-labels.ts.

export type PlaceKind = "district" | "landmark";
export type EePlace = { name: string; kind: PlaceKind; type: string; lon: number; lat: number; pri: number };

/** z13 tile of the places layer (about 3 km over Estonia): one Overpass request and one cache file each. */
export const PZ = 13;
export const ptile = (lon: number, lat: number) => ({ x: Math.floor(((lon + 180) / 360) * 2 ** PZ), y: Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** PZ) });
export function ptileBox(x: number, y: number) {
  const n = 2 ** PZ, lon = (v: number) => (v / n) * 360 - 180, lat = (v: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}
/** Estonia's z13 tiles only (the layer is for the Land Board close-up). */
export const validPTile = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 4585 && x <= 4742 && y >= 2383 && y <= 2492;

/** Districts (place=suburb/quarter/neighbourhood) and landmarks: churches, towers, castles, town halls, the port, museums. */
export function placesQuery(b: { w: number; s: number; e: number; n: number }): string {
  const bb = `(${b.s},${b.w},${b.n},${b.e})`;
  return `[out:json][timeout:40];(node["place"~"^(suburb|quarter|neighbourhood)$"]["name"]${bb};way["place"~"^(suburb|quarter|neighbourhood)$"]["name"]${bb};`
    + `nwr["amenity"~"^(place_of_worship|townhall|ferry_terminal)$"]["name"]${bb};nwr["historic"~"^(castle|tower|city_gate|monument|fort|manor)$"]["name"]${bb};`
    + `nwr["man_made"~"^(tower|lighthouse)$"]["tower:type"!~"communication"]["name"]${bb};nwr["tourism"~"^(museum|attraction|viewpoint)$"]["name"]${bb};`
    + `nwr["landuse"="port"]["name"]${bb};nwr["harbour"]["name"]${bb};);out center tags;`;
}

type Tags = Record<string, string | undefined>;
type El = { type: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; nodes?: number[]; tags?: Tags };

/** What kind of label a tagged OSM element makes, with its weight (higher wins a clash), or null. */
export function classify(t: Tags): { kind: PlaceKind; type: string; pri: number } | null {
  const p = t.place;
  if (p === "suburb") return { kind: "district", type: "district", pri: 90 };
  if (p === "quarter") return { kind: "district", type: "district", pri: 80 };
  if (p === "neighbourhood") return { kind: "district", type: "district", pri: 70 };
  if (t.amenity === "townhall") return { kind: "landmark", type: "townhall", pri: 85 };
  if (t.historic === "castle" || t.historic === "fort" || t.historic === "manor") return { kind: "landmark", type: "castle", pri: 82 };
  if (t.amenity === "ferry_terminal" || t.landuse === "port" || t.harbour) return { kind: "landmark", type: "port", pri: 78 };
  if (t.amenity === "place_of_worship") return { kind: "landmark", type: "church", pri: t.building === "cathedral" || /katedraal|cathedral|kirik|church/i.test(t.name ?? "") ? 76 : 55 };
  if (t.historic === "tower" || t.historic === "city_gate" || t.man_made === "tower" || t.man_made === "lighthouse") return { kind: "landmark", type: "tower", pri: 66 };
  if (t.tourism === "museum") return { kind: "landmark", type: "museum", pri: 52 };
  if (t.tourism === "attraction" || t.tourism === "viewpoint" || t.historic === "monument") return { kind: "landmark", type: "sight", pri: 45 };
  return null;
}

/**
 * Labels from an Overpass answer ("out center") or an OSM API map answer (ways carry node ids: their centre is the mean of the
 * nodes present). The local name, as on street signs; an English name in brackets for landmarks when it differs ("Raekoda (Town Hall)" reads better than either alone). Same name close by: kept once.
 */
export function parsePlaces(j: { elements?: El[] }): EePlace[] {
  const els = j.elements ?? [], nodes = new Map<number, El>();
  for (const e of els) if (e.type === "node" && e.id != null) nodes.set(e.id, e);
  const out: EePlace[] = [];
  for (const e of els) {
    const t = e.tags; if (!t?.name) continue;
    const c = classify(t); if (!c) continue;
    let lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat == null && e.nodes?.length) {
      const ps = e.nodes.map((id) => nodes.get(id)).filter((n): n is El => n?.lat != null);
      if (ps.length) { lat = ps.reduce((s, n) => s + n.lat!, 0) / ps.length; lon = ps.reduce((s, n) => s + n.lon!, 0) / ps.length; }
    }
    if (lat == null || lon == null) continue;
    const en = t["name:en"], name = c.kind === "landmark" && en && en !== t.name && t.name.length + en.length < 40 ? `${t.name} (${en})` : t.name;
    out.push({ name, kind: c.kind, type: c.type, lon: +lon.toFixed(6), lat: +lat.toFixed(6), pri: c.pri });
  }
  out.sort((a, b) => b.pri - a.pri);
  const keep: EePlace[] = [];
  for (const p of out) if (!keep.some((q) => q.name === p.name && Math.abs(q.lat - p.lat) < 0.006 && Math.abs(q.lon - p.lon) < 0.012)) keep.push(p);
  return keep;
}

/* ---------- news pins ---------- */
export type Cat = "transport" | "culture" | "events" | "crime" | "weather" | "city";
/** Category colours, as in the owner's target map (transport red, culture cyan, events violet, city blue). */
export const CAT_COLOR: Record<Cat, string> = { transport: "#ff5a52", culture: "#3fd0ff", events: "#b07cff", crime: "#ffb347", weather: "#9fe7c9", city: "#5aa8ff" };
const CAT_WORDS: [Cat, RegExp][] = [
  ["transport", /\b(traffic|road|street|tram|bus|train|rail|ferry|airport|flight|parking|liiklus|tee|tänav|tramm|buss|rong|praam|lennu|parkimi|ummik|remont)/i],
  ["crime", /\b(police|crime|arrest|court|fire|accident|politsei|kuritegu|kohus|tulekahju|õnnetus|avarii|vargus|päästeamet)/i],
  ["weather", /\b(weather|storm|snow|rain|frost|flood|ilm|torm|lumi|vihm|külm|tuisk|üleujutus)/i],
  ["events", /\b(festival|market|fair|concert|show|match|race|event|laat|turg|kontsert|festival|võistlus|üritus|etendus|jõulu)/i],
  ["culture", /\b(museum|exhibition|theatre|theater|art|library|church|book|film|cinema|muuseum|näitus|teater|kunst|raamat|kino|kirik|kultuur)/i],
];
/** A story's category from its title (English or Estonian words), "city" when nothing matches. */
export function storyCat(title: string): Cat {
  for (const [c, re] of CAT_WORDS) if (re.test(title)) return c;
  return "city";
}
/** "16:20" today, "Tue 16:20" this week, else "12 Jan". Local time of the viewer (tz for tests). */
export function pinTime(iso: string | null | undefined, now: number, tz?: string): string {
  if (!iso) return ""; const d = new Date(iso); if (Number.isNaN(+d)) return "";
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en-GB", { ...o, timeZone: tz });
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  if (day(d) === day(new Date(now))) return f({ hour: "2-digit", minute: "2-digit" });
  if (now - +d < 6 * 864e5 && +d <= now) return f({ weekday: "short", hour: "2-digit", minute: "2-digit" });
  return f({ day: "numeric", month: "short" });
}
/** Window event a news pin sends when clicked; the Intelligence panel shows that story ("From the map"). */
export const EARTH_STORY_EVENT = "orbit:earth-story";
export type EarthStory = PinStory & { place: string; cat: Cat };
export type PinStory = { title: string; url: string; source: string | null; published_at: string | null };
export type NewsPin = { lon: number; lat: number; place: string; cat: Cat; story: PinStory; pri: number };
/** Lowercase stem of a place name for finding it in a headline ("Kalamaja" → "kalamaj", catches "Kalamajas", "Kalamaja"). */
export function stem(name: string): string {
  const w = name.toLowerCase().split(/[\s(,-]/)[0] ?? "";
  return w.length > 5 ? w.slice(0, -1) : w;
}
/**
 * News pins: a city's 4 newest stories, a district's 2, a town's 1. A story whose title names a nearby district or landmark
 * (`places`) stands there; otherwise on a small ring (~300 m) around its place, so they don't all sit on one spot (the card
 * names the place it belongs to). Newer stories and busier places weigh more. At most `max`.
 */
export function newsPins(towns: { name: string; lon: number; lat: number; kind: string; count: number; stories: PinStory[] }[], now: number, max = 12, places: EePlace[] = []): NewsPin[] {
  const out: NewsPin[] = [], stems = places.map((p) => ({ p, s: stem(p.name) })).filter((x) => x.s.length >= 5);
  for (const t of towns) {
    const n = t.kind === "city" ? 4 : t.kind === "district" ? 2 : 1;
    t.stories.slice(0, n).forEach((s, i) => {
      const age = s.published_at ? Math.max(0, (now - Date.parse(s.published_at)) / 36e5) : 48, low = s.title.toLowerCase();
      const at = stems.find((x) => low.includes(x.s) && Math.abs(x.p.lat - t.lat) < 0.15 && Math.abs(x.p.lon - t.lon) < 0.3)?.p;
      const ang = i * 2.4 + 0.7, r = i ? 0.0028 : 0; // the lead story on the place itself
      out.push({ lon: at?.lon ?? t.lon + Math.cos(ang) * r * 1.9, lat: at?.lat ?? t.lat + Math.sin(ang) * r, place: at ? `${at.name.split(" (")[0]}, ${t.name}` : t.name, cat: storyCat(s.title), story: s,
        pri: (t.kind === "district" ? 40 : 20) + Math.min(20, t.count) - Math.min(30, age / 4) - i * 6 });
    });
  }
  return out.sort((a, b) => b.pri - a.pri).slice(0, max);
}

/* ---------- placing labels on screen ---------- */
export type Box = [number, number, number, number]; // x0 y0 x1 y1
export type Cand = { id: string; x: number; y: number; w: number; h: number; pri: number; lead?: number; group?: string };
export type Placed = { id: string; x: number; y: number; bx: number; by: number; leader: boolean };
const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/**
 * Greedy decluttering: highest weight first, each label tries its anchor's spots (right, left, above, below; with a leader line
 * `lead` px long when it has one) and takes the first one inside `area` that hits no placed label, no blocked box and no anchor
 * dot of an already placed label. Labels with no free spot are dropped (never drawn over each other or a panel). `caps` limits
 * how many of a group get placed (e.g. at most 8 landmarks: a calm map, not a gazetteer).
 */
export function declutter(cands: Cand[], area: Box, blocked: Box[], pad = 4, caps: Record<string, number> = {}): Placed[] {
  const taken: Box[] = [...blocked], out: Placed[] = [], used: Record<string, number> = {};
  for (const c of [...cands].sort((a, b) => b.pri - a.pri)) {
    if (c.group && caps[c.group] != null && (used[c.group] ?? 0) >= caps[c.group]) continue;
    if (c.x < area[0] || c.x > area[2] || c.y < area[1] || c.y > area[3]) continue;
    const L = c.lead ?? 0, g = 6;
    const spots: [number, number][] = L
      ? [[c.x + L, c.y - L - c.h / 2], [c.x - L - c.w, c.y - L - c.h / 2], [c.x - c.w / 2, c.y - L * 1.6 - c.h], [c.x + L, c.y + L * 0.6], [c.x - L - c.w, c.y + L * 0.6], [c.x - c.w / 2, c.y + L * 1.3]]
      : [[c.x - c.w / 2, c.y - c.h / 2], [c.x + g, c.y - c.h / 2], [c.x - g - c.w, c.y - c.h / 2], [c.x - c.w / 2, c.y - c.h - g], [c.x - c.w / 2, c.y + g]];
    for (const [bx, by] of spots) {
      const r: Box = [bx - pad, by - pad, bx + c.w + pad, by + c.h + pad];
      if (r[0] < area[0] || r[1] < area[1] || r[2] > area[2] || r[3] > area[3]) continue;
      if (taken.some((q) => hit(r, q))) continue;
      taken.push(r); if (L) taken.push([c.x - 4, c.y - 4, c.x + 4, c.y + 4]);
      out.push({ id: c.id, x: c.x, y: c.y, bx, by, leader: L > 0 }); if (c.group) used[c.group] = (used[c.group] ?? 0) + 1; break;
    }
  }
  return out;
}
/** Opacity by distance from the camera (km): full up to `near`, gone at `far`. */
export const distFade = (km: number, near: number, far: number) => (km <= near ? 1 : km >= far ? 0 : 1 - (km - near) / (far - near));
