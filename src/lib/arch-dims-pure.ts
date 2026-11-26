// ARCH dimension lines (pure, tested in tests/arch-dims.test.ts): width, depth and height drawn the way a drawing does it, as a line
// set off from the house with extension lines and 45-degree end ticks, and where each label sits (on its line, not floating over the scene).
type V3 = [number, number, number];
export type Fp = { x0: number; x1: number; z0: number; z1: number };
export type Seg = { a: V3; b: V3 };
export type Dims = { main: Seg[]; ext: Seg[]; ticks: Seg[]; outline: V3[]; at: { w: V3; d: V3; h: V3; a: V3 } };

export const DIM = { off: 1.4, over: 0.3, gap: 0.12, tick: 0.2, y: 0.06 };

const tick = (p: V3, d: V3, n: V3, k = DIM.tick): Seg => ({ a: [p[0] + (d[0] + n[0]) * k, p[1] + (d[1] + n[1]) * k, p[2] + (d[2] + n[2]) * k], b: [p[0] - (d[0] + n[0]) * k, p[1] - (d[1] + n[1]) * k, p[2] - (d[2] + n[2]) * k] });

/** Width runs along the south (+z) side, depth along the east (+x) side, height up a vertical line off the north-east corner. */
export function dimLines(f: Fp, top: number): Dims {
  const { off, over, gap, y } = DIM;
  const zw = f.z1 + off, xd = f.x1 + off, hx = f.x1 + off * 0.75, hz = f.z0; // height: up beside the north-east corner (the right-hand edge of the east face as seen from the opening view)
  const main: Seg[] = [{ a: [f.x0, y, zw], b: [f.x1, y, zw] }, { a: [xd, y, f.z0], b: [xd, y, f.z1] }, { a: [hx, 0, hz], b: [hx, top, hz] }];
  const ext: Seg[] = [
    { a: [f.x0, y, f.z1 + gap], b: [f.x0, y, zw + over] }, { a: [f.x1, y, f.z1 + gap], b: [f.x1, y, zw + over] },
    { a: [f.x1 + gap, y, f.z0], b: [xd + over, y, f.z0] }, { a: [f.x1 + gap, y, f.z1], b: [xd + over, y, f.z1] },
    { a: [f.x1 + gap, 0, hz], b: [hx + over * 0.5, 0, hz] }, { a: [f.x1 + gap, top, hz], b: [hx + over * 0.5, top, hz] },
  ];
  const n: V3 = [0, 0, 1], e: V3 = [1, 0, 0], u: V3 = [0, 1, 0];
  const ticks: Seg[] = [
    tick([f.x0, y, zw], e, n), tick([f.x1, y, zw], e, n), tick([xd, y, f.z0], n, e), tick([xd, y, f.z1], n, e),
    tick([hx, 0, hz], u, [1, 0, 0]), tick([hx, top, hz], u, [1, 0, 0]),
  ];
  const outline: V3[] = [[f.x0, y, f.z0], [f.x1, y, f.z0], [f.x1, y, f.z1], [f.x0, y, f.z1], [f.x0, y, f.z0]];
  return { main, ext, ticks, outline, at: { w: [(f.x0 + f.x1) / 2, y, zw], d: [xd, y, (f.z0 + f.z1) / 2], h: [hx, top / 2, hz], a: [(f.x0 + f.x1) / 2, y, zw + 1.15] } };
}
