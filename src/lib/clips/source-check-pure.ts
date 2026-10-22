// Re-upload check on a downloaded source, before clipping: burned-in subtitles or a static watermark mean
// the video was already someone else's clip. Pure pixel statistics on a few tiny grayscale frames.
import { IN } from "./pure.ts";

export const CHECK_W = 128, CHECK_H = 128, CHECK_FRAMES = 6;
export type SourceCheck = { subtitles: boolean; watermark: boolean; scores: { subtitleFrames: number; watermarkCells: number; staticShare: number } };

/** One tiny grey frame at `at` seconds, raw bytes to `out` (fast seek: well under a second each). */
export const checkFrameArgs = (input: string, at: number, out: string) =>
  ["-hide_banner", "-nostdin", "-y", "-ss", at.toFixed(2), ...IN, input, "-map", "0:v:0", "-an", "-sn", "-frames:v", "1",
    "-vf", `scale=${CHECK_W}:${CHECK_H}:flags=area,format=gray`, "-f", "rawvideo", out];

/** Evenly spread sample times, away from intros/outros. */
export const checkTimes = (duration: number, n = CHECK_FRAMES) => Array.from({ length: n }, (_, i) => duration * (0.05 + 0.9 * (i + 0.5) / n));

const STATIC = 12, EDGE = 48;

export function checkSource(frames: Uint8Array[], w: number, h: number): SourceCheck {
  const n = frames.length, size = w * h;
  const none: SourceCheck = { subtitles: false, watermark: false, scores: { subtitleFrames: 0, watermarkCells: 0, staticShare: 1 } };
  if (n < 3 || frames.some((f) => f.length < size)) return none;
  // Per pixel: static across all frames (range ≤ STATIC), and the mean frame.
  const still = new Uint8Array(size), mean = new Float32Array(size);
  let stillCount = 0;
  for (let p = 0; p < size; p++) {
    let lo = 255, hi = 0, sum = 0;
    for (const f of frames) { const v = f[p]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    mean[p] = sum / n;
    if (hi - lo <= STATIC) { still[p] = 1; stillCount++; }
  }
  const staticShare = stillCount / size;

  // Watermark: a few small cells holding static *edges* (both sides static, so letterbox borders don't count).
  const cell = 16, gx = Math.ceil(w / cell), gy = Math.ceil(h / cell), hits = new Uint16Array(gx * gy);
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const p = y * w + x;
    if (!still[p]) continue;
    if ((still[p + 1] && Math.abs(mean[p] - mean[p + 1]) > EDGE) || (still[p + w] && Math.abs(mean[p] - mean[p + w]) > EDGE)) hits[Math.floor(y / cell) * gx + Math.floor(x / cell)]++;
  }
  const watermarkCells = [...hits].filter((c) => c >= cell * cell * 0.06).length;
  // shortcut: a static streamer overlay/logo in the original VOD also matches; upgrade with a vision confirm if that bites.
  const watermark = staticShare < 0.5 && watermarkCells >= 1 && watermarkCells <= 6; // the rest must move; many cells = HUD/frame/static video

  // Subtitles: a band of moving high-contrast edges in the lower part, well above the frame's usual edge density.
  const band = Math.max(2, Math.round(h * 0.04)), x0 = Math.floor(w * 0.1), x1 = Math.ceil(w * 0.9);
  let subtitleFrames = 0;
  for (const f of frames) {
    const rows = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = x0; x < x1 - 1; x++) { const p = y * w + x; if (!still[p] && Math.abs(f[p] - f[p + 1]) > EDGE) c++; }
      rows[y] = c / (x1 - x0 - 1);
    }
    const median = [...rows].sort((a, b) => a - b)[h >> 1];
    let best = 0;
    for (let y = Math.floor(h * 0.55); y + band <= Math.floor(h * 0.95); y++) {
      let s = 0;
      for (let k = 0; k < band; k++) s += rows[y + k];
      best = Math.max(best, s / band);
    }
    if (best >= 0.12 && best >= 3 * (median + 0.01)) subtitleFrames++;
  }
  return { subtitles: subtitleFrames >= Math.ceil(n * 0.6), watermark, scores: { subtitleFrames, watermarkCells, staticShare: Math.round(staticShare * 1000) / 1000 } };
}

export const reuploadWarning = (c: SourceCheck) => !c.subtitles && !c.watermark ? null
  : `Looks like a re-upload: ${[c.subtitles && "burned-in subtitles", c.watermark && "watermark"].filter(Boolean).join(" + ")}`;
