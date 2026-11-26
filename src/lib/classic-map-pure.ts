// Intelligence map: pure helpers for the news layer on the photoreal Earth (label placement, ring size, sun). Used by earth-scene.ts.
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

/** Sun position (lat/lon in degrees) at a time, the same simple model the Earth view uses. */
export function sunAt(ms: number) {
  const d = new Date(ms), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (ms - y0) / 864e5;
  return { lat: -23.44 * Math.cos((2 * Math.PI / 365.25) * (doy + 10)), lon: -((d.getUTCHours() + d.getUTCMinutes() / 60) - 12) * 15 };
}
