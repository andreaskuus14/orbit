import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFormat, parsePlyHeader, readSplats, SH_C0 } from "../src/lib/splat-pure.ts";

const PROPS = ["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];

function ply(rows: number[][], opts: { props?: string[]; count?: number; extraHeader?: string; cut?: number } = {}): Uint8Array {
  const props = opts.props ?? PROPS;
  const header = [
    "ply", "format binary_little_endian 1.0", "comment test",
    `element vertex ${opts.count ?? rows.length}`,
    ...props.map((p) => `property float ${p}`),
    ...(opts.extraHeader ? [opts.extraHeader] : []),
    "end_header", "",
  ].join("\n");
  const head = new TextEncoder().encode(header);
  const out = new Uint8Array(head.length + rows.length * props.length * 4);
  out.set(head);
  const dv = new DataView(out.buffer);
  rows.forEach((r, i) => r.forEach((v, k) => dv.setFloat32(head.length + (i * props.length + k) * 4, v, true)));
  return opts.cut ? out.subarray(0, out.length - opts.cut) : out;
}

// row in PROPS order
const row = (x: number, o: Partial<Record<string, number>> = {}) =>
  PROPS.map((p) => o[p] ?? ({ x, y: x + 1, z: x + 2, rot_0: 1 } as Record<string, number>)[p] ?? 0);

function splat(recs: { pos: number[]; scale: number[]; rgba: number[]; rot: number[] }[]): Uint8Array {
  const out = new Uint8Array(recs.length * 32);
  const dv = new DataView(out.buffer);
  recs.forEach((r, i) => {
    const b = i * 32;
    [...r.pos, ...r.scale].forEach((v, k) => dv.setFloat32(b + k * 4, v, true));
    out.set(r.rgba, b + 24);
    out.set(r.rot, b + 28);
  });
  return out;
}

const close = (a: ArrayLike<number>, b: number[], eps = 1e-5) =>
  assert.ok(a.length === b.length && b.every((v, i) => Math.abs(a[i] - v) < eps), `${Array.from(a)} != ${b}`);

test("parsePlyHeader: count, properties, stride, offsets", () => {
  const b = ply([row(0)]);
  const h = parsePlyHeader(b);
  assert.equal(h.vertexCount, 1);
  assert.equal(h.stride, PROPS.length * 4);
  assert.deepEqual(h.properties.slice(0, 2), [{ name: "x", type: "float", offset: 0 }, { name: "y", type: "float", offset: 4 }]);
  assert.equal(h.properties.find((p) => p.name === "rot_3")!.offset, 13 * 4);
  assert.equal(h.dataOffset, b.length - PROPS.length * 4);
});

test("parsePlyHeader: mixed types and trailing elements", () => {
  const text = "ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty uchar a\nproperty double b\nproperty short c\nelement face 0\nproperty list uchar int vertex_indices\nend_header\n";
  const h = parsePlyHeader(new TextEncoder().encode(text));
  assert.equal(h.stride, 11);
  assert.deepEqual(h.properties.map((p) => p.offset), [0, 1, 9]);
});

test("parsePlyHeader rejects bad headers", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  assert.throws(() => parsePlyHeader(enc("nope")), /Not a PLY/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n")), /ascii/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n")), /big_endian/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\n")), /end_header/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_little_endian 1.0\nelement vertex -1\nproperty float x\nend_header\n")), /vertex count/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float16 x\nend_header\n")), /bad property/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_little_endian 1.0\nelement face 1\nproperty float x\nelement vertex 1\nend_header\n")), /first element/);
  assert.throws(() => parsePlyHeader(enc("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty list uchar float x\nend_header\n")), /list/);
});

test("readSplats PLY: activations", () => {
  const s = readSplats(ply([row(1, { scale_0: 0, scale_1: Math.log(2), scale_2: -1, f_dc_0: 1, f_dc_1: -10, f_dc_2: 10, opacity: 0, rot_0: 2, rot_1: 0, rot_2: 0, rot_3: 0 })]));
  assert.equal(s.format, "ply");
  assert.equal(s.count, 1);
  close(s.positions, [1, 2, 3]);
  close(s.scales, [1, 2, Math.exp(-1)]);
  close(s.rotations, [1, 0, 0, 0]);
  close(s.colors, [SH_C0 + 0.5, 0, 1]);
  close(s.opacities, [0.5]);
});

test("readSplats PLY: quaternions are normalised, zero quaternion becomes identity", () => {
  const s = readSplats(ply([row(0, { rot_0: 0, rot_1: 3, rot_2: 4 }), row(0, { rot_0: 0 })]));
  close(s.rotations, [0, 0.6, 0.8, 0, 1, 0, 0, 0]);
});

test("readSplats PLY: non-finite splats are dropped", () => {
  const s = readSplats(ply([row(0, { x: NaN }), row(5), row(0, { scale_0: 1000 }), row(0, { opacity: Infinity, f_dc_0: NaN })]));
  assert.equal(s.total, 4);
  assert.equal(s.count, 1);
  assert.equal(s.skipped, 3);
  close(s.positions, [5, 6, 7]);
  for (const a of [s.positions, s.scales, s.rotations, s.colors, s.opacities]) assert.ok(Array.from(a).every(Number.isFinite));
});

test("readSplats PLY: missing property, truncated data", () => {
  assert.throws(() => readSplats(ply([row(0).slice(0, 13)], { props: PROPS.slice(0, 13) })), /missing rot_3/);
  assert.throws(() => readSplats(ply([row(0), row(1)], { cut: 1 })), /truncated/);
  assert.throws(() => readSplats(ply([row(0)], { count: 5 })), /truncated/);
});

test("readSplats PLY: extra properties (f_rest_*, normals) are skipped by offset", () => {
  const props = ["nx", ...PROPS, "f_rest_0"];
  const s = readSplats(ply([[9, ...row(4), 9]], { props }));
  close(s.positions, [4, 5, 6]);
});

test("readSplats downsamples evenly", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i));
  const s = readSplats(ply(rows), 4);
  assert.equal(s.total, 10);
  assert.equal(s.count, 4);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => s.positions[i * 3]), [0, 2, 5, 7]);
  assert.equal(readSplats(ply(rows), 10).count, 10);
  assert.equal(readSplats(ply(rows), 1).positions[0], 0);
  assert.throws(() => readSplats(ply(rows), 0), /max/);
  assert.throws(() => readSplats(ply(rows), 1.5), /max/);
});

test("readSplats .splat: 32-byte records", () => {
  const b = splat([
    { pos: [1, 2, 3], scale: [0.1, 0.2, 0.3], rgba: [255, 0, 51, 128], rot: [128 + 64, 128, 128, 128] },
    { pos: [4, 5, 6], scale: [1, 1, 1], rgba: [0, 0, 0, 255], rot: [128, 128, 128, 128] },
  ]);
  assert.equal(detectFormat(b), "splat");
  const s = readSplats(b);
  assert.equal(s.format, "splat");
  assert.equal(s.count, 2);
  close(s.positions, [1, 2, 3, 4, 5, 6]);
  close(s.scales, [0.1, 0.2, 0.3, 1, 1, 1]);
  close(s.colors, [1, 0, 0.2, 0, 0, 0]);
  close(s.opacities, [128 / 255, 1]);
  close(s.rotations, [1, 0, 0, 0, 1, 0, 0, 0]);
});

test("readSplats .splat: non-finite record dropped; bad length rejected", () => {
  const s = readSplats(splat([
    { pos: [NaN, 0, 0], scale: [1, 1, 1], rgba: [0, 0, 0, 0], rot: [255, 128, 128, 128] },
    { pos: [0, 0, 0], scale: [Infinity, 1, 1], rgba: [0, 0, 0, 0], rot: [255, 128, 128, 128] },
    { pos: [7, 8, 9], scale: [1, 1, 1], rgba: [0, 0, 0, 0], rot: [255, 128, 128, 128] },
  ]));
  assert.equal(s.count, 1);
  close(s.positions, [7, 8, 9]);
  assert.throws(() => readSplats(new Uint8Array(33)), /Unrecognised/);
  assert.throws(() => readSplats(new Uint8Array(0)), /Empty/);
});

test("readSplats refuses .spz clearly", () => {
  assert.throws(() => readSplats(new Uint8Array([0x1f, 0x8b, 8, 0, ...new Array(28).fill(0)])), /\.spz.*not supported yet/);
  assert.throws(() => readSplats(new Uint8Array([0x4e, 0x47, 0x53, 0x50, 2, 0, 0, 0])), /\.spz.*not supported yet/);
});

test("readSplats respects subarray byteOffset", () => {
  const inner = splat([{ pos: [1, 2, 3], scale: [1, 1, 1], rgba: [0, 0, 0, 0], rot: [255, 128, 128, 128] }]);
  const big = new Uint8Array(inner.length + 8);
  big.set(inner, 8);
  close(readSplats(big.subarray(8)).positions, [1, 2, 3]);
});

// ---- 5.1/5.2: viewer helpers ----
import { packSplats, scanBounds, sortByDepth, splatBudget, TEX_ROW, texSize, writeSplat } from "../src/lib/splat-pure.ts";

test("writeSplat round-trips through readSplats (.splat), within 8-bit colour/rotation precision", () => {
  const src = splat([
    { pos: [1, 2, 3], scale: [0.1, 0.2, 0.3], rgba: [255, 128, 0, 200], rot: [255, 128, 128, 128] },
    { pos: [-4, 5, -6], scale: [1, 1, 1], rgba: [10, 20, 30, 40], rot: [128, 255, 128, 128] },
  ]);
  const a = readSplats(src), b = readSplats(writeSplat(a));
  assert.equal(b.count, 2);
  close(b.positions, [...a.positions]);
  close(b.scales, [...a.scales]);
  close(b.colors, [...a.colors], 1 / 255);
  close(b.opacities, [...a.opacities], 1 / 255);
  close(b.rotations, [...a.rotations], 0.02);
});

test("packSplats: identity rotation gives diagonal covariance = scale², colour packed into 24 bits", () => {
  const s = readSplats(splat([{ pos: [1, 2, 3], scale: [0.5, 2, 3], rgba: [255, 1, 2, 128], rot: [255, 128, 128, 128] }]));
  const t = packSplats(s);
  assert.equal(t.length, texSize(1).width * texSize(1).height * 4);
  assert.equal(texSize(1).width, TEX_ROW * 3);
  close(t.subarray(0, 3), [1, 2, 3]);
  close([t[3], t[6], t[8]], [0.25, 4, 9], 2e-3); // xx yy zz (rotation byte 255 ≈ w 0.992, renormalised)
  close([t[4], t[5], t[7]], [0, 0, 0], 1e-6);
  assert.equal(t[9], 255 * 65536 + 1 * 256 + 2);
  close([t[10]], [128 / 255]);
});

test("packSplats: a 90° turn about z swaps the x and y variances", () => {
  const h = Math.SQRT1_2, s = { format: "splat" as const, total: 1, count: 1, skipped: 0, positions: new Float32Array(3), scales: new Float32Array([1, 3, 1]),
    rotations: new Float32Array([h, 0, 0, h]), colors: new Float32Array(3), opacities: new Float32Array([1]) };
  const t = packSplats(s);
  close([t[3], t[6], t[8], t[4]], [9, 1, 1, 0], 1e-5);
});

test("sortByDepth: farthest along the view direction first, subset capped evenly", () => {
  const pos = new Float32Array([0, 0, 1, 0, 0, 5, 0, 0, 3, 0, 0, -2]); // z = 1, 5, 3, -2
  assert.deepEqual([...sortByDepth(pos, [0, 0, 1], 10)], [1, 2, 0, 3]);
  assert.deepEqual([...sortByDepth(pos, [0, 0, -1], 10)], [3, 0, 2, 1]);
  assert.deepEqual([...sortByDepth(pos, [0, 0, 1], 2)].sort(), [0, 2]); // every 2nd splat
  assert.equal(sortByDepth(new Float32Array(0), [0, 0, 1], 5).length, 0);
  assert.deepEqual([...sortByDepth(new Float32Array([1, 1, 1, 1, 1, 1]), [1, 0, 0], 5)].sort(), [0, 1]); // all equal depth
});

test("scanBounds ignores stray floaters (2nd–98th percentile)", () => {
  const n = 1000, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[i * 3] = i / n * 10; p[i * 3 + 1] = 1; p[i * 3 + 2] = 0; }
  p[0] = -500; p[3] = 900; // floaters
  const b = scanBounds(p);
  assert.ok(b.lo[0] > -1 && b.lo[0] < 0.5, `lo ${b.lo[0]}`);
  assert.ok(b.hi[0] < 10 && b.hi[0] > 9.5, `hi ${b.hi[0]}`);
  assert.deepEqual([b.lo[1], b.hi[1]], [1, 1]);
});

test("splatBudget follows the world quality preset", () => {
  assert.deepEqual(splatBudget(1), { cap: 80_000, maxPx: 200 });
  assert.equal(splatBudget(1.25).cap, 160_000);
  assert.equal(splatBudget(1.75).cap, 300_000);
});
