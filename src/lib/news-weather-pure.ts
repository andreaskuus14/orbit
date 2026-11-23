// INTELLIGENCE → "news weather": today's stories as a weather map over the globe. Pure; tests in tests/news-weather.test.ts.
// Storm = a story 5+ independent outlets confirm (independentSources). Cell = a story still forming (1–4 outlets).
// Front = one event cluster shared by two countries, pointing from where it was reported first. Isobars = a gaussian
// "how much news is in the air" field over the hotspots, contoured with marching squares (no d3 dependency).
// Input shapes: /api/news/geo hotspots and /api/briefings (content + citations with evidence).
import { clusterEvents, independentSources, type Art } from "./news-intel-pure.ts";
import { displayName, regionOf, REGIONS, type Hotspot } from "./geo.ts";
import { gapAfter, script, stories as briefingStories } from "./briefing-audio-pure.ts";
import { REGION_ET } from "./news-weather-text-pure.ts";

/** Same values as REGION_COLOR in NewsGlobe.tsx (kept here until the full build moves it to one shared place). */
export const REGION_COLOR: Record<string, string> = {
  Americas: "#fbbf24", Europe: "#4ade80", "Middle East": "#f87171", Africa: "#facc15", Asia: "#fb923c", Oceania: "#22d3ee",
};
export const NO_REGION_COLOR = "#fb923c";
export const STORM_MIN = 5;

export type Kind = "storm" | "cell";
export const kindOf = (outlets: number): Kind | null => (outlets >= STORM_MIN ? "storm" : outlets >= 1 ? "cell" : null);

export type WxOutlet = { source: string; url: string };
export type WxSystem = {
  key: string; country: string; label: string; lat: number; lon: number; region: string | null; color: string;
  title: string; kind: Kind; outlets: number; reports: number; sources: WxOutlet[]; urls: string[];
};
export type WxFront = { key: string; title: string; from: string; to: string; outlets: number; color: string };

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const outletOf = (a: { source: string | null; url: string }) => (a.source?.trim() || hostOf(a.url));
const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0);

/** One article per outlet (its earliest), then syndicated copies across outlets count once: "independent outlets". */
export function independentOutlets<T extends Art>(group: T[]): T[] {
  const byOutlet = new Map<string, T>();
  for (const a of [...group].sort((x, y) => time(x.published_at) - time(y.published_at) || x.url.localeCompare(y.url))) {
    const o = outletOf(a).toLowerCase();
    if (!byOutlet.has(o)) byOutlet.set(o, a);
  }
  const firsts = [...byOutlet.values()];
  // Keep the order independentSources counts in, dropping later copies of the same text.
  const kept: T[] = [];
  for (const a of firsts) if (independentSources([...kept, a]) > kept.length) kept.push(a);
  return kept;
}

const asArt = (s: Hotspot["stories"][number]): Art => ({ id: s.url, title: s.title, url: s.url, source: s.source, published_at: s.published_at });
const colorOf = (country: string) => REGION_COLOR[regionOf(country) ?? ""] ?? NO_REGION_COLOR;

/** One pressure system per country: its biggest event cluster, classified by independent outlets. */
export function systems(hs: Hotspot[]): WxSystem[] {
  return hs.flatMap((h) => {
    const top = clusterEvents(h.stories.map(asArt))[0];
    if (!top) return [];
    const ind = independentOutlets(top), kind = kindOf(ind.length);
    if (!kind) return [];
    const lead = ind[0];
    return [{ key: h.name, country: h.name, label: displayName(h.name), lat: h.lat, lon: h.lon, region: regionOf(h.name), color: colorOf(h.name),
      title: lead.title, kind, outlets: ind.length, reports: h.count, sources: ind.map((a) => ({ source: outletOf(a), url: a.url })), urls: top.map((a) => a.url) }];
  }).sort((a, b) => b.outlets - a.outlets || b.reports - a.reports);
}

/** Fronts: an event cluster that two countries share (2+ independent outlets). From = where it was reported first. */
export function fronts(hs: Hotspot[], max = 3): WxFront[] {
  const byUrl = new Map<string, Art & { countries: Set<string> }>();
  for (const h of hs) for (const s of h.stories) {
    const a = byUrl.get(s.url) ?? { ...asArt(s), countries: new Set<string>() };
    a.countries.add(h.name); byUrl.set(s.url, a);
  }
  const out: WxFront[] = [];
  for (const g of clusterEvents([...byUrl.values()])) {
    const n = independentOutlets(g).length;
    if (n < 2) continue;
    const per = new Map<string, { n: number; first: number }>();
    for (const a of g) for (const c of a.countries) {
      const p = per.get(c) ?? { n: 0, first: Infinity };
      per.set(c, { n: p.n + 1, first: Math.min(p.first, time(a.published_at)) });
    }
    if (per.size < 2) continue;
    const [x, y] = [...per.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 2);
    const [from, to] = x[1].first <= y[1].first ? [x[0], y[0]] : [y[0], x[0]];
    out.push({ key: `${from}>${to}`, title: g[0].title, from, to, outlets: n, color: colorOf(to) });
  }
  const seen = new Set<string>();
  return out.filter((f) => { const k = [f.from, f.to].sort().join("|"); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.outlets - a.outlets).slice(0, max);
}

/** "3 storms, 2 fronts. Calm over Africa and Oceania." Calm = a region with no storm or cell at all. Estonian too. */
export function forecast(sys: WxSystem[], fr: WxFront[], lang = "en"): string {
  const et = lang === "et";
  const storms = sys.filter((s) => s.kind === "storm").length;
  const pl = (n: number, w: string) => (et ? `${n} ${w === "storm" ? (n === 1 ? "torm" : "tormi") : n === 1 ? "front" : "fronti"}` : `${n} ${w}${n === 1 ? "" : "s"}`);
  const head = storms || fr.length ? `${pl(storms, "storm")}, ${pl(fr.length, "front")}.` : et ? "Täna torme pole." : "No storms today.";
  const busy = new Set(sys.map((s) => s.region));
  const all = Object.keys(REGIONS), calm = all.filter((r) => !busy.has(r)).map((r) => (et ? REGION_ET[r] ?? r : r));
  const and = et ? "ja" : "and";
  const list = calm.length > 1 ? `${calm.slice(0, -1).join(", ")} ${and} ${calm[calm.length - 1]}` : calm[0];
  return calm.length && calm.length < all.length ? `${head} ${et ? `Vaikne: ${list}.` : `Calm over ${list}.`}` : head;
}

/** Headline cut at a word boundary to fit a label; the trailing " - Outlet" tag goes first. */
export function shortTitle(t: string, max = 34): string {
  const s = t.replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

// ---------- the briefing side ----------
export type Cite = { id: string; title?: string; url: string; source?: string | null; evidence?: "fetched" | "snippet"; published_at?: string | null };
export type Beam = { source: string; url: string; fetched: boolean };
export type Stop = { system: WxSystem; headline: string; lines: string[]; confirmed: boolean; beams: Beam[]; section: string };

/** The system a briefing story is about: the one whose cluster holds most of the story's cited URLs. */
export function systemFor(sys: WxSystem[], urls: string[]): WxSystem | null {
  const want = new Set(urls);
  let best: WxSystem | null = null, bestN = 0;
  for (const s of sys) { const n = s.urls.filter((u) => want.has(u)).length; if (n > bestN || (n === bestN && n && best && s.outlets > best.outlets)) { best = s; bestN = n; } }
  return best;
}

/** Wrap text into at most `n` lines of `width` characters (the lower third has room for two). */
export function wrapLines(text: string, width = 62, n = 2): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur ? cur.length + 1 : 0) + w.length <= width) { cur = cur ? `${cur} ${w}` : w; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === n) break;
  }
  if (out.length < n && cur) out.push(cur);
  const all = text.split(/\s+/).filter(Boolean).join(" ");
  if (out.join(" ").length < all.length) { // more text than room: end the last line on a word with an ellipsis
    const last = out[n - 1], sp = last.length >= width ? last.lastIndexOf(" ") : last.length;
    out[n - 1] = `${last.slice(0, sp).replace(/[\s,;:–—-]+$/, "")}…`;
  }
  return out;
}

/** The flythrough stops: each briefing story, the system it lands on, and one beam per outlet (bright = read in full).
 *  Stories are matched to their "###" block by headline, so a story the audio parser drops can't shift the citations. */
export function stops(md: string, cites: Cite[], sys: WxSystem[]): Stop[] {
  const byId = new Map(cites.map((c) => [c.id.toLowerCase(), c]));
  const blocks = md.split(/\n(?=###\s)/).filter((b) => /^###\s/.test(b.trimStart()));
  const head = (b: string) => briefingStories(`${b.trimStart().split("\n")[0]}\nx.`)[0]?.headline ?? "";
  const byHead = new Map(blocks.map((b) => [head(b), b]));
  return briefingStories(md).flatMap((s) => {
    const ids = [...(byHead.get(s.headline) ?? "").matchAll(/\[a:([0-9a-f-]{36})\]/gi)].map((m) => m[1].toLowerCase());
    const cited = ids.map((id) => byId.get(id)).filter((c): c is Cite => !!c);
    const system = systemFor(sys, cited.map((c) => c.url));
    if (!system) return [];
    const fetched = new Set(cited.filter((c) => c.evidence === "fetched").map((c) => c.url));
    const beams = system.sources.map((o) => ({ source: o.source, url: o.url, fetched: fetched.has(o.url) }))
      .sort((a, b) => Number(b.fetched) - Number(a.fetched)).slice(0, MAX_BEAMS);
    return [{ system, headline: s.headline, lines: wrapLines(s.facts.join(" ")), confirmed: !s.single, section: s.section, beams }];
  });
}
/** At most this many outlet beams per story (the brightest first), so the chip row always fits. */
export const MAX_BEAMS = 6;

// ---------- voice timing ----------
/** When each story starts in the briefing audio, in ms. The show is script() read line by line with gapAfter() pauses, so a
 *  story starts after the intro and the stories before it; speech time is spread by characters and scaled to the real length. */
export function storyCues(title: string, md: string, durationMs: number): number[] {
  const lines = script(title, md), st = briefingStories(md);
  const w = lines.map((l, i) => l.text.length + gapAfter(l, lines[i + 1]) * 15); // ~15 characters a second
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const at: number[] = [];
  let line = 1, acc = w[0];
  for (const s of st) {
    at.push((acc / total) * durationMs);
    const hasNote = !!s.why || s.single;
    const n = 1 + (hasNote ? 1 : 0);
    for (let k = 0; k < n && line < lines.length; k++) acc += w[line++];
  }
  return at;
}

export type PlanStop = { start: number; end: number };
export const TOUR = { min: 60_000, max: 75_000, lead: 2500, minStop: 6500, maxStop: 14_000 } as const;
/** The flythrough timeline in ms. With the audio: each stop starts `lead` before its story is read (the camera lands as the
 *  voice starts) and ends where the next begins. Without: the stops share ~66 s (60–75 s), each 6.5–14 s. */
export function tourPlan(n: number, cues?: number[] | null, durationMs?: number): PlanStop[] {
  if (!n) return [];
  if (cues && cues.length >= n && durationMs) {
    const st = cues.slice(0, n).map((c, i) => (i === 0 ? 0 : Math.max(0, c - TOUR.lead)));
    for (let i = 1; i < n; i++) st[i] = Math.max(st[i], st[i - 1] + 3000);
    return st.map((s, i) => ({ start: s, end: i + 1 < n ? st[i + 1] : Math.max(durationMs, s + TOUR.minStop) }));
  }
  const each = Math.min(TOUR.maxStop, Math.max(TOUR.minStop, 66_000 / n));
  return Array.from({ length: n }, (_, i) => ({ start: i * each, end: (i + 1) * each }));
}
/** Which stop is on at tour time `t` (ms), and how far into it. Past the end: index n (the tour is over). */
export function stopAt(plan: PlanStop[], t: number): { i: number; local: number } {
  if (!plan.length || t >= plan[plan.length - 1].end) return { i: plan.length, local: 0 };
  let i = 0;
  while (i + 1 < plan.length && plan[i + 1].start <= t) i++;
  return { i, local: Math.max(0, t - plan[i].start) };
}

// ---------- since you last looked ----------
export type Snapshot = { at: number; systems: Record<string, number>; fronts: string[] };
export const snapshotOf = (sys: WxSystem[], fr: WxFront[], at: number): Snapshot =>
  ({ at, systems: Object.fromEntries(sys.map((s) => [s.key, s.outlets])), fronts: fr.map((f) => [f.from, f.to].sort().join("|")) });
export type Change = { kind: "grew" | "weakened" | "new" | "front"; key: string; text: string };
/** What changed since the viewer's last snapshot: storms that grew or weakened (by outlets), new storms, new fronts. */
export function sinceLast(prev: Snapshot | null, sys: WxSystem[], fr: WxFront[], max = 3, lang = "en"): Change[] {
  if (!prev) return [];
  const et = lang === "et";
  const out: Change[] = [];
  for (const s of sys) {
    const was = prev.systems[s.key];
    if (was === undefined) { if (s.kind === "storm") out.push({ kind: "new", key: s.key, text: et ? `Uus torm: ${s.label}` : `New storm over ${s.label}` }); continue; }
    if (s.outlets > was && (s.kind === "storm" || was >= STORM_MIN)) out.push({ kind: "grew", key: s.key, text: et ? `${s.label}: torm kasvas, ${was} → ${s.outlets} väljaannet` : `${s.label} storm grew: ${was} → ${s.outlets} outlets` });
    else if (s.outlets < was) out.push({ kind: "weakened", key: s.key, text: et ? `${s.label}: nõrgeneb, ${was} → ${s.outlets}` : `${s.label} ${s.kind} weakening: ${was} → ${s.outlets}` });
  }
  const known = new Set(prev.fronts);
  for (const f of fr) if (!known.has([f.from, f.to].sort().join("|"))) out.push({ kind: "front", key: f.key, text: `${et ? "Uus front" : "New front"}: ${displayName(f.from)} ↔ ${displayName(f.to)}` });
  const rank = { grew: 0, front: 1, new: 2, weakened: 3 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, max);
}
/** Keep the old snapshot until it is at least `minAgeMs` old, so a quick reload doesn't wipe what changed. */
export const shouldReplace = (prev: Snapshot | null, now: number, minAgeMs = 30 * 60_000) => !prev || now - prev.at >= minAgeMs;
export function parseSnapshot(raw: string | null): Snapshot | null {
  try {
    const v = JSON.parse(raw ?? "null");
    return v && typeof v.at === "number" && v.systems && typeof v.systems === "object" && Array.isArray(v.fronts) ? v : null;
  } catch { return null; }
}

// ---------- isobars ----------
export type Field = { v: Float64Array; gw: number; gh: number; max: number };
const RAD = Math.PI / 180;
/** Great-circle distance in degrees. */
export function arcDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / RAD;
}
/** Sum of gaussians over the hotspots on a lon/lat grid: height √reports, width 5° + 1.1°·√reports. Cell centres. */
export function pressureField(pts: { lon: number; lat: number; reports: number }[], gw = 180, gh = 90): Field {
  const v = new Float64Array(gw * gh);
  let max = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const lon = ((x + 0.5) / gw) * 360 - 180, lat = 90 - ((y + 0.5) / gh) * 180;
    let s = 0;
    for (const p of pts) {
      const d = arcDeg(lon, lat, p.lon, p.lat), w = 5 + Math.sqrt(p.reports) * 1.1;
      if (d < w * 4) s += Math.sqrt(p.reports) * Math.exp(-(d * d) / (2 * w * w));
    }
    v[y * gw + x] = s; if (s > max) max = s;
  }
  return { v, gw, gh, max };
}
export const fieldAt = (f: Field, gx: number, gy: number) => f.v[gy * f.gw + (((gx % f.gw) + f.gw) % f.gw)];
const toLonLat = (f: Field, gx: number, gy: number): [number, number] => [((gx + 0.5) / f.gw) * 360 - 180, 90 - ((gy + 0.5) / f.gh) * 180];

/** Isobar levels: `n` steps from 12% to 88% of the field's peak, spaced so the busy core gets the tight rings. */
export function isobarLevels(max: number, n = 7): number[] {
  if (!(max > 0)) return [];
  return Array.from({ length: n }, (_, i) => max * (0.12 + 0.76 * (i / (n - 1)) ** 1.35));
}

/** Marching squares, wrapping in longitude. Returns each level's lines as [lon, lat] polylines (segments chained). */
export function contours(f: Field, levels: number[]): { level: number; lines: [number, number][][] }[] {
  return levels.map((L) => {
    const segs: [number, number, number, number][] = [];
    for (let y = 0; y < f.gh - 1; y++) for (let x = 0; x < f.gw; x++) {
      const a = fieldAt(f, x, y), b = fieldAt(f, x + 1, y), c = fieldAt(f, x + 1, y + 1), d = fieldAt(f, x, y + 1);
      const code = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const t = (p: number, q: number) => (L - p) / (q - p || 1e-9);
      const top: [number, number] = [x + t(a, b), y], right: [number, number] = [x + 1, y + t(b, c)];
      const bottom: [number, number] = [x + t(d, c), y + 1], left: [number, number] = [x, y + t(a, d)];
      const add = (p: [number, number], q: [number, number]) => segs.push([p[0], p[1], q[0], q[1]]);
      const centre = (a + b + c + d) / 4 > L;
      switch (code) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: if (centre) { add(left, top); add(bottom, right); } else { add(left, bottom); add(top, right); } break;
        case 10: if (centre) { add(top, right); add(left, bottom); } else { add(left, top); add(bottom, right); } break;
      }
    }
    return { level: L, lines: chain(segs, f.gw).map((l) => l.map(([gx, gy]) => { const [lon, lat] = toLonLat(f, gx, gy); return [lon > 180 ? lon - 360 : lon, lat] as [number, number]; })) };
  });
}

/** Join segments that share endpoints into polylines (keys on the wrapped grid so the seam joins too). */
function chain(segs: [number, number, number, number][], gw: number): [number, number][][] {
  const key = (x: number, y: number) => `${(((x % gw) + gw) % gw).toFixed(4)},${y.toFixed(4)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const k of [key(s[0], s[1]), key(s[2], s[3])]) ends.set(k, [...(ends.get(k) ?? []), i]); });
  const used = new Uint8Array(segs.length), out: [number, number][][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: [number, number][] = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (const dir of [1, -1]) {
      for (;;) {
        const p = dir === 1 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(p[0], p[1])) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const s = segs[next], startHere = key(s[0], s[1]) === key(p[0], p[1]);
        const q: [number, number] = startHere ? [s[2], s[3]] : [s[0], s[1]];
        // Keep longitude continuous across the seam so a line never jumps the whole map.
        while (q[0] - p[0] > gw / 2) q[0] -= gw;
        while (p[0] - q[0] > gw / 2) q[0] += gw;
        if (dir === 1) line.push(q); else line.unshift(q);
      }
    }
    out.push(line);
  }
  return out;
}

// ---------- the whole model ----------
export type Briefing = { id: string; title: string; content: string; citations?: Cite[] | null; created_at?: string };
export type Weather = { systems: WxSystem[]; fronts: WxFront[]; isobars: { level: number; lines: [number, number][][] }[]; forecast: string; stops: Stop[] };
/** Everything the weather view draws, from /api/news/geo hotspots and today's briefing (if any). */
export function weather(hs: Hotspot[], briefing: Briefing | null, lang = "en"): Weather {
  const sys = systems(hs), fr = fronts(hs);
  const f = pressureField(hs.map((h) => ({ lon: h.lon, lat: h.lat, reports: h.count })));
  const isobars = contours(f, isobarLevels(f.max));
  const st = briefing ? stops(briefing.content, briefing.citations ?? [], sys) : [];
  return { systems: sys, fronts: fr, isobars, forecast: forecast(sys, fr, lang), stops: st };
}
