// ARCH: Gaussian-splat scan loading (iPhone Scaniverse / Polycam exports), tested in tests/splat.test.ts.
// Pure: bytes in, typed arrays out. Formats: binary_little_endian PLY (3DGS layout) and antimatter15 `.splat`.
// `.spz` is detected and refused (no parser yet).

export type PlyType = "char" | "uchar" | "short" | "ushort" | "int" | "uint" | "float" | "double";
export type PlyProperty = { name: string; type: PlyType; offset: number };
export type PlyHeader = { vertexCount: number; properties: PlyProperty[]; stride: number; dataOffset: number };

export type Splats = {
  format: "ply" | "splat";
  /** Splats in the file. */
  total: number;
  /** Splats returned (after downsampling and dropping non-finite ones). */
  count: number;
  /** Dropped because a value was NaN/Infinity. */
  skipped: number;
  positions: Float32Array; // xyz × count
  scales: Float32Array; // linear xyz × count
  rotations: Float32Array; // unit quaternion (w, x, y, z) × count
  colors: Float32Array; // rgb 0..1 × count
  opacities: Float32Array; // 0..1 × count
};

export const SH_C0 = 0.28209479;
export const SPLAT_STRIDE = 32;
export const DEFAULT_MAX_SPLATS = 300_000;
const MAX_HEADER = 64 * 1024;

const TYPES: Record<string, { type: PlyType; size: number }> = {
  char: { type: "char", size: 1 }, int8: { type: "char", size: 1 },
  uchar: { type: "uchar", size: 1 }, uint8: { type: "uchar", size: 1 },
  short: { type: "short", size: 2 }, int16: { type: "short", size: 2 },
  ushort: { type: "ushort", size: 2 }, uint16: { type: "ushort", size: 2 },
  int: { type: "int", size: 4 }, int32: { type: "int", size: 4 },
  uint: { type: "uint", size: 4 }, uint32: { type: "uint", size: 4 },
  float: { type: "float", size: 4 }, float32: { type: "float", size: 4 },
  double: { type: "double", size: 8 }, float64: { type: "double", size: 8 },
};

const PLY_REQUIRED = ["x", "y", "z", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3", "f_dc_0", "f_dc_1", "f_dc_2", "opacity"];

const startsWith = (b: Uint8Array, s: string) => b.length >= s.length && [...s].every((c, i) => b[i] === c.charCodeAt(0));

/** Which format the bytes are, by magic number (`.splat` has none: any other length that is a multiple of 32). */
export function detectFormat(b: Uint8Array): "ply" | "spz" | "splat" | null {
  if (startsWith(b, "ply\n") || startsWith(b, "ply\r\n")) return "ply";
  // .spz: gzip stream, or the raw inner header "NGSP" (0x5053474e little-endian).
  if ((b[0] === 0x1f && b[1] === 0x8b) || startsWith(b, "NGSP")) return "spz";
  if (b.length > 0 && b.length % SPLAT_STRIDE === 0) return "splat";
  return null;
}

/** Parse a binary_little_endian PLY header. The vertex element must come first; later elements are ignored. */
export function parsePlyHeader(bytes: Uint8Array): PlyHeader {
  if (!startsWith(bytes, "ply")) throw new Error("Not a PLY file (missing 'ply' magic).");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, MAX_HEADER)));
  const m = /end_header\r?\n/.exec(head);
  if (!m) throw new Error("PLY header has no end_header (file truncated or header over 64 KB).");
  const dataOffset = m.index + m[0].length;
  const lines = head.slice(0, m.index).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let format = "";
  let vertexCount = -1;
  let element = ""; // current element name
  let sawElement = false;
  const properties: PlyProperty[] = [];
  let stride = 0;
  for (const line of lines.slice(1)) {
    const w = line.split(/\s+/);
    if (w[0] === "comment" || w[0] === "obj_info") continue;
    if (w[0] === "format") {
      format = w[1] ?? "";
    } else if (w[0] === "element") {
      if (!sawElement && w[1] !== "vertex") throw new Error(`PLY: the first element must be 'vertex', got '${w[1]}'.`);
      sawElement = true;
      element = w[1] ?? "";
      if (element === "vertex") {
        if (vertexCount >= 0) throw new Error("PLY: duplicate vertex element.");
        if (!/^\d+$/.test(w[2] ?? "")) throw new Error(`PLY: bad vertex count '${w[2]}'.`);
        vertexCount = Number(w[2]);
        if (!Number.isSafeInteger(vertexCount)) throw new Error("PLY: vertex count too large.");
      }
    } else if (w[0] === "property") {
      if (element !== "vertex") continue;
      if (w[1] === "list") throw new Error("PLY: list properties on vertices are not supported.");
      const t = TYPES[w[1] ?? ""];
      const name = w[2];
      if (!t || !name || w.length !== 3) throw new Error(`PLY: bad property line '${line}'.`);
      if (properties.some((p) => p.name === name)) throw new Error(`PLY: duplicate property '${name}'.`);
      properties.push({ name, type: t.type, offset: stride });
      stride += t.size;
    } else {
      throw new Error(`PLY: unexpected header line '${line}'.`);
    }
  }
  if (format !== "binary_little_endian") throw new Error(`PLY format '${format || "missing"}' not supported (need binary_little_endian).`);
  if (vertexCount < 0) throw new Error("PLY: no vertex element.");
  if (stride === 0) throw new Error("PLY: vertex element has no properties.");
  return { vertexCount, properties, stride, dataOffset };
}

function reader(view: DataView, t: PlyType): (at: number) => number {
  switch (t) {
    case "char": return (at) => view.getInt8(at);
    case "uchar": return (at) => view.getUint8(at);
    case "short": return (at) => view.getInt16(at, true);
    case "ushort": return (at) => view.getUint16(at, true);
    case "int": return (at) => view.getInt32(at, true);
    case "uint": return (at) => view.getUint32(at, true);
    case "float": return (at) => view.getFloat32(at, true);
    case "double": return (at) => view.getFloat64(at, true);
  }
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Read a splat scan into typed arrays, evenly downsampled to at most `max` splats. Throws on malformed input. */
export function readSplats(bytes: Uint8Array, max: number = DEFAULT_MAX_SPLATS): Splats {
  if (!Number.isSafeInteger(max) || max < 1) throw new Error("max must be a positive integer.");
  if (bytes.length === 0) throw new Error("Empty file.");
  const fmt = detectFormat(bytes);
  if (fmt === "spz") throw new Error(".spz (compressed Niantic splat) is not supported yet; export as .ply or .splat.");
  if (fmt === null) throw new Error(`Unrecognised splat file: not PLY, and ${bytes.length} bytes is not a multiple of ${SPLAT_STRIDE} for .splat.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let total: number;
  let base: number;
  let stride: number;
  // Fills out[0..13] = x y z, sx sy sz, qw qx qy qz, r g b, opacity for record i.
  let read: (at: number, out: Float64Array) => void;

  if (fmt === "ply") {
    const h = parsePlyHeader(bytes);
    const missing = PLY_REQUIRED.filter((n) => !h.properties.some((p) => p.name === n));
    if (missing.length) throw new Error(`PLY is not a Gaussian splat: missing ${missing.join(", ")}.`);
    const need = h.dataOffset + h.vertexCount * h.stride;
    if (bytes.length < need) throw new Error(`PLY truncated: header promises ${h.vertexCount} vertices (${need} bytes), file has ${bytes.length}.`);
    const get = PLY_REQUIRED.map((n) => {
      const p = h.properties.find((q) => q.name === n)!;
      const r = reader(view, p.type);
      return (at: number) => r(at + p.offset);
    });
    total = h.vertexCount;
    base = h.dataOffset;
    stride = h.stride;
    read = (at, o) => {
      for (let k = 0; k < 3; k++) o[k] = get[k](at);
      for (let k = 3; k < 6; k++) o[k] = Math.exp(get[k](at));
      for (let k = 6; k < 10; k++) o[k] = get[k](at);
      for (let k = 10; k < 13; k++) o[k] = clamp01(SH_C0 * get[k](at) + 0.5);
      o[13] = sigmoid(get[13](at));
    };
  } else {
    total = bytes.length / SPLAT_STRIDE;
    base = 0;
    stride = SPLAT_STRIDE;
    read = (at, o) => {
      for (let k = 0; k < 6; k++) o[k] = view.getFloat32(at + k * 4, true);
      for (let k = 0; k < 3; k++) o[10 + k] = bytes[at + 24 + k] / 255;
      o[13] = bytes[at + 27] / 255;
      for (let k = 0; k < 4; k++) o[6 + k] = (bytes[at + 28 + k] - 128) / 128;
    };
  }

  const n = Math.min(total, max);
  const step = total / n; // >= 1; even spread over the whole file
  const positions = new Float32Array(n * 3);
  const scales = new Float32Array(n * 3);
  const rotations = new Float32Array(n * 4);
  const colors = new Float32Array(n * 3);
  const opacities = new Float32Array(n);
  const o = new Float64Array(14);
  let count = 0;
  for (let i = 0; i < n; i++) {
    read(base + Math.floor(i * step) * stride, o);
    const len = Math.hypot(o[6], o[7], o[8], o[9]);
    if (len > 0 && Number.isFinite(len)) for (let k = 6; k < 10; k++) o[k] /= len;
    else { o[6] = 1; o[7] = o[8] = o[9] = 0; } // degenerate rotation -> identity
    // Float32 can overflow where Float64 did not (e.g. exp(100)), so check the narrowed values.
    let ok = true;
    for (let k = 0; k < 14; k++) if (!Number.isFinite(Math.fround(o[k]))) { ok = false; break; }
    if (!ok) continue;
    positions.set([o[0], o[1], o[2]], count * 3);
    scales.set([o[3], o[4], o[5]], count * 3);
    rotations.set([o[6], o[7], o[8], o[9]], count * 4);
    colors.set([o[10], o[11], o[12]], count * 3);
    opacities[count] = o[13];
    count++;
  }
  return {
    format: fmt, total, count, skipped: n - count,
    positions: positions.subarray(0, count * 3),
    scales: scales.subarray(0, count * 3),
    rotations: rotations.subarray(0, count * 4),
    colors: colors.subarray(0, count * 3),
    opacities: opacities.subarray(0, count),
  };
}
