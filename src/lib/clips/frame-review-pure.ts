// STUDIO frame review: before the Short is assembled, look at a few key frames of every scene and judge them against the owner's
// cinematic standard (site-guide.ts: no stand-in art, sharp enough for the screen it plays on). ffmpeg's signalstats measures
// brightness, contrast and colour for free; nothing leaves the PC. A blank scene stops the render, weak ones become warnings.
// Disk side: reviewFrames in story-render.ts. Tests: tests/frame-review.test.ts.

export type FrameStats = { yavg: number; ymin: number; ymax: number; satavg: number; w?: number; h?: number };
export type SceneReview = { scene: number; frames: (FrameStats | null)[] };

/** Where to look: an image has one frame; a clip is sampled near its start, middle and end (never on the cut itself). */
export function sampleTimes(sec: number, video: boolean, n = 3): number[] {
  if (!video || !(sec > 0.6)) return [0];
  const k = Math.max(3, Math.min(5, n));
  return Array.from({ length: k }, (_, i) => Math.round(sec * (0.12 + (0.76 * i) / (k - 1)) * 100) / 100);
}

/** One small decoded frame through signalstats; the stats land in ffmpeg's log (stderr), which runFfmpeg returns. */
export const reviewArgs = (file: string, t: number) =>
  ["-hide_banner", ...(t > 0 ? ["-ss", String(t)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2,signalstats,metadata=print", "-f", "null", "-"];

/** The frame's numbers from that log, or null when ffmpeg printed none (a dry run, an unreadable file). */
export function parseStats(log: string): FrameStats | null {
  const v = (k: string) => { const m = [...log.matchAll(new RegExp(`lavfi\\.signalstats\\.${k}=(-?[\\d.]+)`, "g"))].at(-1); return m ? Number(m[1]) : NaN; };
  const s = { yavg: v("YAVG"), ymin: v("YMIN"), ymax: v("YMAX"), satavg: v("SATAVG") };
  if (![s.yavg, s.ymin, s.ymax, s.satavg].every(Number.isFinite)) return null;
  const size = /Stream #\d+:\d+[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(log.split("Output #0")[0]);
  return size ? { ...s, w: Number(size[1]), h: Number(size[2]) } : s;
}

/** What a viewer would notice in one frame (8-bit luma, 16–235 video range). Empty = fine. */
export function frameIssues(f: FrameStats): string[] {
  const out: string[] = [];
  if (f.ymax - f.ymin < 12) return ["blank"]; // one flat colour (black, white or a grey stand-in box): nothing to see
  if (f.yavg < 38) out.push("too dark");
  else if (f.yavg > 215) out.push("blown out");
  if (f.ymax - f.ymin < 70) out.push("flat (no contrast)");
  if (f.w && f.h && Math.min(f.w, f.h) < 720) out.push(`soft (${f.w}x${f.h}, under 720 px for a 1080x1920 Short)`);
  return out;
}

/** The verdict before rendering: `stop` lists scenes that are blank in every frame (nothing to show), `warn` the weak rest.
 *  A scene whose clip shows the same picture at every sample may be frozen. Unmeasured frames are never judged. */
export function verdict(scenes: SceneReview[]): { stop: string[]; warn: string[] } {
  const stop: string[] = [], warn: string[] = [];
  for (const s of scenes) {
    const seen = s.frames.filter((f): f is FrameStats => !!f);
    if (!seen.length) continue;
    const issues = seen.map(frameIssues), n = `Scene ${s.scene + 1}`;
    if (issues.every((i) => i[0] === "blank")) { stop.push(`${n} is blank`); continue; }
    const counts = new Map<string, number>();
    for (const i of issues) for (const x of new Set(i.map((y) => y.replace(/ \(.*/, "")))) counts.set(x, (counts.get(x) ?? 0) + 1);
    for (const [x, c] of counts) if (c * 2 >= seen.length) warn.push(`${n}: ${x} in ${c} of ${seen.length} key frames`);
    if (seen.length >= 3 && Math.max(...seen.map((f) => f.yavg)) - Math.min(...seen.map((f) => f.yavg)) < 0.3 && Math.max(...seen.map((f) => f.satavg)) - Math.min(...seen.map((f) => f.satavg)) < 0.3)
      warn.push(`${n}: every key frame looks the same; the clip may be frozen`);
  }
  return { stop, warn };
}
