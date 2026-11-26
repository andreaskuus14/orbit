// Glass chips over a 3D world: projected anchor points → screen boxes that never overlap each other or the planet's
// panel. Greedy by priority: each chip tries a few spots around its anchor; one that can't fit cleanly is hidden.
// Pure: tests in tests/world-chips.test.ts.

export type Box = { x: number; y: number; w: number; h: number };
/** x/y: anchor on screen (px). w/h: the chip's measured size. prio: higher places first. on: false = behind camera / off. */
export type ChipIn = { id: string; x: number; y: number; w: number; h: number; prio: number; on: boolean; /** a dimension label: tried first centred on its anchor (it sits on its line) */ centre?: boolean };
export type ChipOut = { x: number; y: number; side: "up" | "down" | "left" | "right" } | null;

const LIFT = 14; // chip sits this far above its anchor (room for the stem)
export const hits = (a: Box, b: Box, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Where each chip goes (top-left px), or null when it can't be shown without covering something. */
export function layoutChips(chips: ChipIn[], view: { w: number; h: number }, blocked: Box[], gap = 6, edge = 8): Map<string, ChipOut> {
  const out = new Map<string, ChipOut>(), placed: Box[] = [];
  const order = [...chips].sort((a, b) => b.prio - a.prio || a.id.localeCompare(b.id));
  for (const c of order) {
    if (!c.on || !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.w <= 0) { out.set(c.id, null); continue; }
    const tries: [number, number, NonNullable<ChipOut>["side"]][] = [
      ...(c.centre ? [[c.x - c.w / 2, c.y - c.h / 2, "up"] as [number, number, "up"]] : []),
      [c.x - c.w / 2, c.y - c.h - LIFT, "up"],
      [c.x - c.w / 2, c.y + LIFT, "down"],
      [c.x + LIFT, c.y - c.h / 2, "right"],
      [c.x - c.w - LIFT, c.y - c.h / 2, "left"],
      [c.x - c.w / 2, c.y - c.h * 2 - LIFT - gap, "up"],
    ];
    let got: ChipOut = null;
    for (const [x, y, side] of tries) {
      const b = { x, y, w: c.w, h: c.h };
      if (x < edge || y < edge || x + c.w > view.w - edge || y + c.h > view.h - edge) continue;
      if (blocked.some((k) => hits(b, k, gap)) || placed.some((k) => hits(b, k, gap))) continue;
      got = { x: Math.round(x), y: Math.round(y), side };
      placed.push(b);
      break;
    }
    out.set(c.id, got);
  }
  return out;
}
