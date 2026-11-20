// Face-aware "follow" reframing, the pure half (face.ts runs the model). YuNet (OpenCV Zoo, MIT) finds faces on frames sampled
// at TRACK_FPS; here: decode its raw outputs, link faces into tracks, tell a streamer's corner facecam from the subject, and
// turn the subject's track into crop targets for reframe.ts smoothPath. Shots without a subject face keep the motion targets
// (with the facecam masked out, so gameplay framing isn't pulled toward the cam). AutoFlip is the reference design.
import { TRACK_H, TRACK_W, type Sample } from "./reframe.ts";

export const YUNET = {
  // OpenCV Zoo's dynamic-shape re-export of face_detection_yunet_2023mar (any input size, multiples of 32). 230 KB, MIT.
  file: "face_detection_yunet_2026may.onnx",
  url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx",
  sha256: "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
  bytes: 229_738,
  license: "MIT",
} as const;

export const FACE_W = 640; // detection frame width (faces of ~10-300 px: a corner facecam face is ~30 px here)
export const FACE_PRE = 0.5; // the worker sends cells over this score; decodeYunet keeps FACE_SCORE and over after NMS
export const FACE_SCORE = 0.7;
export const FACE_SMOOTH = { dead: 0.06, speed: 0.5, accel: 1.5 }; // positions, positions/s, positions/s² (ease in/out)

/** A face as fractions of the source frame: top-left corner, size, detector score. */
export type Face = { x: number; y: number; w: number; h: number; score: number };

const STRIDES = [8, 16, 32];

/** YuNet cells the worker kept (flat: stride, cell index, score, 4 box values per cell) → faces in 0..1 of the w0 x h0 picture
 *  (the frame was padded to padW x padH at its right/bottom). Same decoding as OpenCV's FaceDetectorYN, then NMS. */
export function decodeYunet(cells: ArrayLike<number>, padW: number, padH: number, w0: number, h0: number, thr = FACE_SCORE): Face[] {
  const faces: Face[] = [];
  for (let k = 0; k + 7 <= cells.length; k += 7) {
    const s = cells[k], idx = cells[k + 1], score = cells[k + 2];
    if (!STRIDES.includes(s) || score < thr) continue;
    const cols = Math.floor(padW / s), r = Math.floor(idx / cols), c = idx % cols;
    const cx = (c + cells[k + 3]) * s, cy = (r + cells[k + 4]) * s, w = Math.exp(cells[k + 5]) * s, h = Math.exp(cells[k + 6]) * s;
    const x1 = Math.max(0, cx - w / 2), y1 = Math.max(0, cy - h / 2), x2 = Math.min(w0, cx + w / 2), y2 = Math.min(h0, cy + h / 2);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    faces.push({ x: x1 / w0, y: y1 / h0, w: (x2 - x1) / w0, h: (y2 - y1) / h0, score });
  }
  return nms(faces);
}

export function iou(a: Face, b: Face): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = ix * iy;
  return i / (a.w * a.h + b.w * b.h - i || 1);
}

/** Greedy non-maximum suppression, best score first. */
export function nms(faces: Face[], thr = 0.3): Face[] {
  const out: Face[] = [];
  for (const f of [...faces].sort((a, b) => b.score - a.score)) if (out.every((o) => iou(o, f) <= thr)) out.push(f);
  return out;
}

export type Track = { shot: number; at: Map<number, Face> }; // sample index → face
const cx = (f: Face) => f.x + f.w / 2, cy = (f: Face) => f.y + f.h / 2;
const MAX_GAP = 4; // samples (1 s at 4 fps) a face may go missing (a blink, a turn) and still be the same track

/** Faces per sample → tracks: each face joins the nearest live track of its shot (overlapping, or centre within ~a face size),
 *  else starts a new one. A cut ends every track. */
export function buildTracks(frames: Face[][], cuts: boolean[]): Track[] {
  const tracks: (Track & { last: number })[] = [];
  let shot = 0;
  frames.forEach((faces, i) => {
    if (i && cuts[i]) shot++;
    const live = tracks.filter((t) => t.shot === shot && i - t.last <= MAX_GAP);
    const pairs: { t: (typeof tracks)[number]; f: Face; d: number }[] = [];
    for (const f of faces) for (const t of live) {
      const g = t.at.get(t.last)!, d = Math.hypot(cx(f) - cx(g), cy(f) - cy(g)) / Math.max(g.w, g.h, f.w, f.h);
      if (iou(f, g) > 0.1 || d < 1) pairs.push({ t, f, d });
    }
    const usedT = new Set<Track>(), usedF = new Set<Face>();
    for (const p of pairs.sort((a, b) => a.d - b.d)) {
      if (usedT.has(p.t) || usedF.has(p.f)) continue;
      usedT.add(p.t); usedF.add(p.f); p.t.at.set(i, p.f); p.t.last = i;
    }
    for (const f of faces) if (!usedF.has(f)) tracks.push({ shot, at: new Map([[i, f]]), last: i });
  });
  return tracks.map(({ shot, at }) => ({ shot, at }));
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** A streamer's facecam: a small face that sits still in a corner for at least 1.5 s. */
export function isFacecam(t: Track): boolean {
  const fs = [...t.at.values()];
  if (fs.length < 6) return false;
  const x = median(fs.map(cx)), y = median(fs.map(cy)), h = median(fs.map((f) => f.h));
  const still = Math.max(...fs.map((f) => Math.hypot(cx(f) - x, cy(f) - y))) < 0.04;
  return still && h < 0.3 && (x < 0.33 || x > 0.67) && (y < 0.4 || y > 0.6);
}

export type CamSide = "tl" | "tr" | "bl" | "br";

/** Where the facecam box is, guessed from the face in it (centred in a box flush with the corner): the corner and the
 *  box width as a fraction of the frame width (camSize, 0.1-0.6 in steps of 0.05). null = no facecam. */
export function facecamGuess(tracks: Track[]): { side: CamSide; size: number; face: Face } | null {
  let best: { t: Track; n: number } | null = null;
  for (const t of tracks) if (isFacecam(t) && (!best || t.at.size > best.n)) best = { t, n: t.at.size };
  if (!best) return null;
  const fs = [...best.t.at.values()], x = median(fs.map(cx)), y = median(fs.map(cy));
  const face = { x: median(fs.map((f) => f.x)), y: median(fs.map((f) => f.y)), w: median(fs.map((f) => f.w)), h: median(fs.map((f) => f.h)), score: median(fs.map((f) => f.score)) };
  const side = `${y < 0.5 ? "t" : "b"}${x < 0.5 ? "l" : "r"}` as CamSide;
  const size = Math.min(0.6, Math.max(0.1, Math.round((2 * (x < 0.5 ? x : 1 - x)) / 0.05) * 0.05));
  return { side, size: Math.round(size * 100) / 100, face };
}

/** TRACK_W x TRACK_H mask (1 = ignore) over each facecam's box: from its corner to 1.6 face sizes past the face centre. */
export function camMask(cams: Face[], w = TRACK_W, h = TRACK_H): Uint8Array | undefined {
  if (!cams.length) return undefined;
  const m = new Uint8Array(w * h);
  for (const f of cams) {
    const left = cx(f) < 0.5, top = cy(f) < 0.5;
    const x0 = left ? 0 : cx(f) - 1.6 * f.w, x1 = left ? cx(f) + 1.6 * f.w : 1, y0 = top ? 0 : cy(f) - 1.6 * f.h, y1 = top ? cy(f) + 1.6 * f.h : 1;
    for (let y = Math.max(0, Math.floor(y0 * h)); y < Math.min(h, Math.ceil(y1 * h)); y++)
      for (let x = Math.max(0, Math.floor(x0 * w)); x < Math.min(w, Math.ceil(x1 * w)); x++) m[y * w + x] = 1;
  }
  return m;
}

/** Crop position (0..1 of the crop's travel) that centres x (0..1 of the frame) in a crop `frac` of the frame wide. */
export const centreOn = (x: number, frac: number) => (frac >= 1 ? 0.5 : Math.min(1, Math.max(0, (x - frac / 2) / (1 - frac))));

/** The subject of a shot: its biggest, steadiest non-facecam track (sum of area x score), if it is on screen for at least
 *  30% of the shot and not tiny (a face in a crowd). */
export function subjectOf(tracks: Track[], shotLen: number): Track | null {
  let best: Track | null = null, bestScore = 0;
  for (const t of tracks) {
    if (isFacecam(t)) continue;
    const fs = [...t.at.values()];
    if (t.at.size < Math.max(2, 0.3 * shotLen) || median(fs.map((f) => f.h)) < 0.06) continue;
    const score = fs.reduce((a, f) => a + f.w * f.h * f.score, 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

export type FaceFollow = { samples: Sample[]; faceShots: number; shots: number; cams: Face[] };

/** Motion samples (reframe.ts motionSamples: targets + cuts, ideally already computed with camMask) + faces per sample →
 *  the samples to smooth. Per shot: a subject face → its centre (with any other big face that fits in the crop, framed
 *  together); a sample where the subject is missing holds (null); no subject → the motion targets as they were. */
export function faceFollow(motion: Sample[], frames: Face[][], aspect: number): FaceFollow {
  const frac = 9 / 16 / aspect, cuts = motion.map((s) => !!s.cut);
  const tracks = buildTracks(motion.map((_, i) => frames[i] ?? []), cuts);
  const cams = tracks.filter(isFacecam).map((t) => { const fs = [...t.at.values()]; return { x: median(fs.map((f) => f.x)), y: median(fs.map((f) => f.y)), w: median(fs.map((f) => f.w)), h: median(fs.map((f) => f.h)), score: 1 }; });
  const shotOf: number[] = [];
  cuts.forEach((c, i) => shotOf.push(i ? shotOf[i - 1] + (c ? 1 : 0) : 0));
  const shots = (shotOf.at(-1) ?? 0) + 1;
  const samples = motion.map((s) => ({ ...s }));
  let faceShots = 0;
  for (let sh = 0; sh < shots; sh++) {
    const idx = shotOf.flatMap((v, i) => (v === sh ? [i] : []));
    const subj = subjectOf(tracks.filter((t) => t.shot === sh), idx.length);
    if (!subj) continue;
    faceShots++;
    const others = tracks.filter((t) => t.shot === sh && t !== subj && !isFacecam(t));
    for (const i of idx) {
      const f = subj.at.get(i);
      if (!f) { samples[i].p = null; continue; }
      let lo = f.x, hi = f.x + f.w;
      for (const t of others) { // a second big face (interview, duo) joins the frame if both still fit with some margin
        const g = t.at.get(i);
        if (g && g.w * g.h >= 0.4 * f.w * f.h && Math.max(hi, g.x + g.w) - Math.min(lo, g.x) <= 0.85 * frac) { lo = Math.min(lo, g.x); hi = Math.max(hi, g.x + g.w); }
      }
      samples[i].p = centreOn((lo + hi) / 2, frac);
    }
    const first = idx.find((i) => samples[i].p !== null); // open the shot on the face, not on the centre, when it shows up late
    for (const i of idx) { if (i === first) break; samples[i].p = samples[first!].p; }
  }
  return { samples, faceShots, shots, cams };
}

const CORNER: Record<CamSide, string> = { tl: "top-left", tr: "top-right", bl: "bottom-left", br: "bottom-right" };

/** Split layout: a warning when the facecam found in the video isn't where the clip's camSide/camSize crop it (null = fine). */
export function camWarning(found: { side: CamSide; size: number } | null, camSide: string, camSize: number): string | null {
  if (!found) return null;
  if (found.side === camSide && Math.abs(found.size - camSize) < 0.1) return null;
  return `Split layout: the facecam looks like it's in the ${CORNER[found.side]} corner (camSide ${found.side}, camSize about ${found.size}), this clip used ${camSide}${camSide.length === 2 ? ` at ${camSize}` : ""}`;
}
