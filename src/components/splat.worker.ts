// ARCH scans (roadmap 5.1/5.2): parsing and the per-view depth sort run here, so a 300 MB .ply never stalls the page.
// Messages: {id, parse: File | ArrayBuffer, max, store} → {id, tex, count, total, format, skipped, bounds, bytes?}
//           {id, sort: [x, y, z], cap} → {id, order}       errors → {id, error}
// The worker keeps the last parsed scan's positions for sorting (one scan open at a time).
import { packSplats, readSplats, scanBounds, sortByDepth, writeSplat } from "../lib/splat-pure.ts";

let positions = new Float32Array(0);

self.onmessage = async (e: MessageEvent<{ id: number; parse?: File | ArrayBuffer; max?: number; store?: boolean; sort?: [number, number, number]; cap?: number }>) => {
  const { id } = e.data;
  try {
    if (e.data.sort) {
      const order = sortByDepth(positions, e.data.sort, e.data.cap ?? Infinity);
      return self.postMessage({ id, order }, { transfer: [order.buffer] });
    }
    const src = e.data.parse!;
    const s = readSplats(new Uint8Array(src instanceof ArrayBuffer ? src : await src.arrayBuffer()), e.data.max);
    positions = s.positions.slice();
    const tex = packSplats(s), bytes = e.data.store ? writeSplat(s) : null;
    self.postMessage({ id, tex, bytes, count: s.count, total: s.total, format: s.format, skipped: s.skipped, bounds: scanBounds(s.positions) },
      { transfer: bytes ? [tex.buffer, bytes.buffer] : [tex.buffer] });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : "Couldn't read that scan" });
  }
};
