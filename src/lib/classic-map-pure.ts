// Classic map v2 (Intelligence): pure helpers for the news layer on the photoreal globe.
export type Box = { x: number; y: number; w: number; h: number };
export type LabelIn = { id: string; x: number; y: number; w: number; h: number; rank: number; facing: number };
export type LabelOut = { id: string; x: number; y: number; show: boolean };

const hit = (a: Box, b: Box, pad = 4) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Places labels next to their anchor (right, left, above, below), most important first; a label that overlaps one
 *  already placed, a panel (zones) or the screen edge in every spot is hidden. Labels on the far side are hidden. */
export function declutter(items: LabelIn[], zones: Box[], screen: { w: number; h: number }): LabelOut[] {
  const placed: Box[] = [];
  const out = new Map<string, LabelOut>();
  for (const it of [...items].sort((a, b) => a.rank - b.rank)) {
    let pos: LabelOut = { id: it.id, x: it.x, y: it.y, show: false };
    if (it.facing > 0.25) {
      const spots: [number, number][] = [[14, -it.h / 2], [-14 - it.w, -it.h / 2], [-it.w / 2, -it.h - 14], [-it.w / 2, 14]];
      for (const [dx, dy] of spots) {
        const b = { x: it.x + dx, y: it.y + dy, w: it.w, h: it.h };
        if (b.x < 8 || b.y < 8 || b.x + b.w > screen.w - 8 || b.y + b.h > screen.h - 8) continue;
        if (zones.some((z) => hit(b, z, 8)) || placed.some((p) => hit(b, p))) continue;
        placed.push(b);
        pos = { id: it.id, x: b.x, y: b.y, show: true };
        break;
      }
    }
    out.set(it.id, pos);
  }
  return items.map((i) => out.get(i.id)!);
}

/** Ring size (globe units) for a hotspot: grows with the square root of its story count, so one huge country can't swamp the map. */
export function ringSize(count: number, max: number) {
  const k = Math.sqrt(Math.min(1, Math.max(0, count) / Math.max(1, max)));
  return 0.07 + 0.2 * k;
}

/** Arcs between related countries: pairs that share stories (same URL), strongest first; falls back to the busiest country
 *  linked to the next few when no stories are shared. */
export function relatedPairs(hs: { name: string; stories: { url: string }[] }[], limit = 8): [string, string, number][] {
  const by = new Map<string, Set<string>>();
  for (const h of hs) for (const s of h.stories) (by.get(s.url) ?? by.set(s.url, new Set()).get(s.url)!).add(h.name);
  const w = new Map<string, number>();
  for (const names of by.values()) {
    const l = [...names].sort();
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const k = `${l[i]}|${l[j]}`; w.set(k, (w.get(k) ?? 0) + 1); }
  }
  const pairs = [...w].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, n]) => { const [a, b] = k.split("|"); return [a, b, n] as [string, string, number]; });
  if (pairs.length) return pairs;
  return hs.slice(1, Math.min(hs.length, 6)).map((h) => [hs[0].name, h.name, 1] as [string, string, number]);
}

/** Sun position (lat/lon in degrees) at a time, the same simple model the Earth view uses. */
export function sunAt(ms: number) {
  const d = new Date(ms), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (ms - y0) / 864e5;
  return { lat: -23.44 * Math.cos((2 * Math.PI / 365.25) * (doy + 10)), lon: -((d.getUTCHours() + d.getUTCMinutes() / 60) - 12) * 15 };
}
