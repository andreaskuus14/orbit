export type RetentionPoint = { t: number; retained: number };
export type RetentionBeat = { start: number; end?: number; label: string };
export type RetentionTranscript = { start: number; end: number; text: string };
export type RetentionMetric = "audienceWatchRatio" | "relativeRetentionPerformance";
export type RetentionInput = {
  points?: readonly RetentionPoint[]; duration: number; metric?: RetentionMetric;
  beats?: readonly RetentionBeat[]; chapters?: readonly RetentionBeat[]; transcript?: readonly RetentionTranscript[];
};
export type RetentionDrop = {
  start: number; end: number; change: number; slope: number;
  /** Percent of the window's starting watch ratio lost; null for relative performance. */
  lostPct: number | null; lostPercentagePoints: number | null;
  beat: RetentionBeat | null; transcript: RetentionTranscript | null;
};
export type RetentionSpike = { start: number; end: number; peak: number; retained: number; prominence: number };
export type RetentionReport = {
  metric: RetentionMetric; samples: number;
  hookHold: { at3s: number | null; at30s: number | null };
  relativeHook: { at3s: number | null; at30s: number | null } | null;
  drops: RetentionDrop[]; rewatchSpikes: RetentionSpike[]; rule: string;
};
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y), mid = Math.floor(a.length / 2);
  return a.length ? a.length % 2 ? a[mid] : a[mid - 1] / 2 + a[mid] / 2 : 0;
};

/** Seconds for duration, beats, chapters and transcript; normalised t for curve points.
 * Ratios above 1 are preserved (repeat viewing). Relative retention is a comparison score,
 * not a viewer fraction: it cannot supply hook hold, percent viewers lost or rewatch evidence.
 * https://developers.google.com/youtube/analytics/metrics#relativeRetentionPerformance
 * Drop attribution is temporal overlap, not evidence that the wording caused the loss.
 */
export function analyzeRetention(input: RetentionInput): RetentionReport {
  const metric = input.metric ?? "audienceWatchRatio", relative = metric === "relativeRetentionPerformance";
  const emptyHook = () => ({ at3s: null, at30s: null });
  const result: RetentionReport = { metric, samples: 0, hookHold: emptyHook(), relativeHook: relative ? emptyHook() : null,
    drops: [], rewatchSpikes: [], rule: "Collect a complete retention curve before changing the edit." };
  const duration = input.duration;
  if (!Number.isFinite(duration) || duration <= 0) return result;
  // Discard malformed observations; do not clamp genuine loops to 100%.
  const sorted = (input.points ?? []).filter((p) => Number.isFinite(p.t) && p.t >= 0 && p.t <= 1 && Number.isFinite(p.retained)
    && p.retained >= 0 && p.retained <= (relative ? 1 : 10000)).slice().sort((a, b) => a.t - b.t || a.retained - b.retained);
  const points: RetentionPoint[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].t === sorted[i].t) j++;
    points.push({ t: sorted[i].t, retained: median(sorted.slice(i, j).map((p) => p.retained)) });
    i = j;
  }
  result.samples = points.length;
  if (!points.length) return result;
  // No extrapolation, nor interpolation across holes wider than 15% of the video.
  const sample = (t: number): number | null => {
    const right = points.findIndex((p) => p.t >= t - 1e-12);
    if (right < 0) return null;
    const b = points[right];
    if (Math.abs(b.t - t) < 1e-12) return b.retained;
    if (right === 0) return null;
    const a = points[right - 1];
    if (b.t - a.t > 0.15 + 1e-12) return null;
    const f = (t - a.t) / (b.t - a.t);
    return a.retained * (1 - f) + b.retained * f;
  };
  const hook = { at3s: duration >= 3 ? sample(3 / duration) : null, at30s: duration >= 30 ? sample(30 / duration) : null };
  if (relative) result.relativeHook = hook; else result.hookHold = hook;
  if (points.length < 3) return result;
  // Equal time spacing makes smoothing independent of the original sampling density.
  // ponytail: fixed 400-bin analysis; increase resolution if sub-bin edit timing becomes necessary.
  const first = points[0].t, span = points.at(-1)!.t - first, step = span / 400;
  if (!(step > 0)) return result;
  const raw = Array.from({ length: 401 }, (_, i) => sample(first + i * step));
  const med = raw.map((v, i) => v === null ? null : i === 0 || i === 400 || raw[i - 1] === null || raw[i + 1] === null
    ? v : median([raw[i - 1]!, v, raw[i + 1]!]));
  const smooth = med.map((v, i) => v === null ? null : i === 0 || i === 400 || med[i - 1] === null || med[i + 1] === null
    ? v : med[i - 1]! / 4 + v / 2 + med[i + 1]! / 4);
  const losses = smooth.slice(1).map((v, i) => v === null || smooth[i] === null ? 0 : (smooth[i]! - v) / step);
  const threshold = Math.max(0.03, 1.5 * median(losses.map((v) => Math.max(0, v))));
  const windows: { a: number; b: number }[] = [];
  for (let i = 0; i < losses.length;) {
    if (losses[i] < threshold) { i++; continue; }
    const a = i;
    while (i < losses.length && losses[i] >= threshold) i++;
    windows.push({ a, b: i });
  }
  // A steady decline still deserves one window, even without a standout steep section.
  if (!windows.length && smooth.every((v) => v !== null) && smooth[0]! - smooth[400]! >= 0.05) windows.push({ a: 0, b: 400 });
  const validBeat = (b: RetentionBeat) => Number.isFinite(b.start) && b.start >= 0 && b.start < duration && typeof b.label === "string"
    && (b.end === undefined || Number.isFinite(b.end) && b.end > b.start);
  const beats = [...(input.beats ?? []), ...(input.chapters ?? [])].filter(validBeat).map((b) => ({ ...b }))
    .sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
  const boundedBeats = beats.map((b, i) => ({ ...b, end: Math.min(duration, b.end ?? beats.find((next, j) => j > i && next.start > b.start)?.start ?? duration) }));
  const transcript = (input.transcript ?? []).filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0
    && s.end > s.start && s.start < duration && typeof s.text === "string").map((s) => ({ ...s, end: Math.min(duration, s.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.text.localeCompare(b.text));
  const overlap = <T extends { start: number; end: number }>(items: T[], start: number, end: number): T | null => {
    let best: T | null = null, size = 0;
    for (const item of items) {
      const amount = Math.min(end, item.end) - Math.max(start, item.start);
      if (amount > size) { best = item; size = amount; }
    }
    return best;
  };
  result.drops = windows.flatMap(({ a, b }) => {
    const change = smooth[a]! - smooth[b]!;
    if (change < 0.04) return [];
    const start = (first + a * step) * duration, end = (first + b * step) * duration;
    return [{ start, end, change, slope: change / (end - start), lostPct: relative ? null : change / smooth[a]! * 100,
      lostPercentagePoints: relative ? null : change * 100, beat: overlap(boundedBeats, start, end), transcript: overlap(transcript, start, end) }];
  }).sort((a, b) => b.change - a.change || b.slope - a.slope || a.start - b.start).slice(0, 3);
  // Interior peaks with >=5 point prominence on BOTH sides are possible rewatch/skip-to moments.
  // A bump alone cannot prove rewinding; relative-performance curves supply no such evidence.
  if (!relative) {
    for (let i = 1; i < 400; i++) {
      const value = smooth[i];
      if (value === null || smooth[i - 1] === null || value <= smooth[i - 1]!) continue;
      let end = i;
      while (end < 400 && smooth[end + 1] === value) end++;
      if (end === 400 || smooth[end + 1] === null || value <= smooth[end + 1]!) continue;
      let left = i, right = end;
      for (let j = i - 1; j >= Math.max(0, i - 40) && smooth[j] !== null; j--) if (smooth[j]! < smooth[left]!) left = j;
      for (let j = end + 1; j <= Math.min(400, end + 40) && smooth[j] !== null; j++) if (smooth[j]! < smooth[right]!) right = j;
      const prominence = Math.min(value - smooth[left]!, value - smooth[right]!);
      if (prominence >= 0.05) result.rewatchSpikes.push({ start: (first + left * step) * duration, end: (first + right * step) * duration,
        peak: (first + (i + end) / 2 * step) * duration, retained: value, prominence });
      i = end;
    }
    result.rewatchSpikes = result.rewatchSpikes.sort((a, b) => b.prominence - a.prominence || a.peak - b.peak)
      .filter((spike, i, all) => !all.slice(0, i).some((other) => Math.abs(other.peak - spike.peak) < step * duration * 40)).slice(0, 3);
  }
  const drop = result.drops[0];
  if (drop) {
    const intro = drop.beat && /\b(intro|introduction)\b/i.test(drop.beat.label) && drop.beat.start === 0;
    result.rule = intro ? `Test cutting the intro to under ${Math.max(1, Math.round(drop.end))} seconds.`
      : drop.start < Math.min(30, duration * 0.2) ? "Test moving the first payoff into the opening 3 seconds."
      : `Review and tighten the beat around ${Math.round((drop.start + drop.end) / 2)} seconds before the next upload.`;
  } else if (span * raw.filter((v) => v !== null).length / raw.length >= 0.8) result.rule = "Keep the current pacing until another video confirms a repeatable drop.";
  return result;
}
