// Personal packaging estimates only: no API, clock, random state or dependencies.
export type ThumbFeatures = { faces: number; textWords: number; contrast: number; dominantHue: number };
export type PackagingCandidate = { title: string; thumbFeatures?: Partial<ThumbFeatures> };
export type PackagingHistory = PackagingCandidate & { ctr: number; impressions: number; avgViewPct: number; publishedAt: string; isShort: boolean };
export const PACKAGING_KEYS = ["length", "number", "question", "colon", "curiosity", "firstPerson", "caps", "emoji", "overlap", "faces", "textWords", "contrast", "hueSin", "hueCos"] as const;
export type PackagingKey = typeof PACKAGING_KEYS[number];
export type PackagingModel = {
  isShort: boolean; mode: "prior" | "fitted"; samples: number; keywords: string[];
  intercept: number; weights: number[]; means: number[]; inverse: number[][];
  noise: number; weightSum: number; effectiveSamples: number;
};
export type PackagingPrediction = { predictedCtr: number; interval: { low: number; high: number }; reasons: string[] };
export type RankedPackaging = PackagingPrediction & { candidateIndex: number; title: string; rank: number; mode: PackagingModel["mode"]; samples: number };
export const MIN_PACKAGING_ROWS = 8;
const PRIOR = [-0.15, 0.08, 0.06, -0.03, 0.1, 0.05, -0.2, -0.08, 0.15, 0.1, -0.15, 0.12, 0, 0];
const NEUTRAL = [0.5, 0, 0, 0, 0, 0, 0.15, 0, 0, 1 / 3, 0.3, 0.5, 0, 0];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-clamp(v, -30, 30)));
const logit = (v: number) => Math.log(clamp(v, 1e-4, 1 - 1e-4) / (1 - clamp(v, 1e-4, 1 - 1e-4)));
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const STOP = new Set("the and for with this that from your you are was how why what when where have has into about just our my".split(" "));
const tokens = (s: string) => [...new Set((s.normalize("NFKC").toLowerCase().match(/[\p{L}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)))];
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Title length is Unicode code points /100; binary flags are 0/1; counts are scaled and capped.
 * contrast is 0..1, hue is degrees and encoded circularly. Missing thumbnail fields stay unknown,
 * not zero: fitting/prediction imputes each at its observed weighted mean. */
export function packagingFeatures(candidate: PackagingCandidate, keywords: readonly string[] = []): (number | null)[] {
  const title = typeof candidate.title === "string" ? candidate.title : "", letters = title.match(/\p{L}/gu) ?? [];
  const words = tokens(title), thumb = candidate.thumbFeatures;
  const feature = (key: keyof ThumbFeatures, scale = 1) => typeof thumb?.[key] === "number" && Number.isFinite(thumb[key]) ? clamp(thumb[key] / scale) : null;
  const hue = typeof thumb?.dominantHue === "number" && Number.isFinite(thumb.dominantHue) ? ((thumb.dominantHue % 360 + 360) % 360) * Math.PI / 180 : null;
  return [clamp([...title].length / 100, 0, 2), +/\d/u.test(title), +title.includes("?"), +title.includes(":"),
    clamp((title.match(/\b(?:secret|surprising|unexpected|hidden|revealed|discover|actually|mistake|nobody)\b/gi) ?? []).length / 3),
    +/\b(?:i|my|me|we|our)\b/i.test(title), letters.length ? letters.filter((c) => c.toUpperCase() === c && c.toLowerCase() !== c).length / letters.length : 0,
    clamp([...graphemes.segment(title)].filter(({ segment }) => /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[#*0-9]\uFE0F?\u20E3|❤/u.test(segment)).length / 3),
    words.length ? words.filter((w) => keywords.includes(w)).length / words.length : 0,
    feature("faces", 3), feature("textWords", 10), feature("contrast"), hue === null ? null : Math.sin(hue), hue === null ? null : Math.cos(hue)];
}

/** Gauss–Jordan with partial pivoting, returning A^-1. Ridge makes this small matrix positive definite. */
function inverse(matrix: number[][]): number[][] {
  const n = matrix.length, a = matrix.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const div = a[k][k];
    for (let j = 0; j < 2 * n; j++) a[k][j] /= div;
    for (let i = 0; i < n; i++) if (i !== k) {
      const mult = a[i][k];
      for (let j = 0; j < 2 * n; j++) a[i][j] -= mult * a[k][j];
    }
  }
  return a.map((r) => r.slice(n));
}

/** CTR is a fraction (0..1); avgViewPct is percent (may exceed 100 for loops). Rows require positive
 * impressions, a real timestamp and a nonempty title. No freshness weighting or current-date reads.
 * Fits logit(CTR) with sqrt(impressions) weights normalised to mean 1 and an unpenalised intercept:
 * beta = (Z'WZ + lambda I)^-1 (Z'W(y - mean(y)) + lambda prior). Features are weighted-centred.
 * Under 8 rows, retain modest prior coefficients and shrink the baseline toward 5% (long) /4% (Short).
 * avgViewPct breaks CTR ties when selecting vocabulary from the top quarter; it is not a CTR target. */
export function fitPackaging(history: readonly PackagingHistory[], isShort = false, lambda = 2): PackagingModel {
  const rows = history.filter((r) => r.isShort === isShort && typeof r.title === "string" && r.title.trim() && Number.isFinite(r.ctr) && r.ctr >= 0 && r.ctr <= 1
    && Number.isFinite(r.impressions) && r.impressions > 0 && Number.isFinite(r.avgViewPct) && r.avgViewPct >= 0 && Number.isFinite(Date.parse(r.publishedAt)))
    .slice().sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.title.localeCompare(b.title) || a.ctr - b.ctr || a.impressions - b.impressions
      || a.avgViewPct - b.avgViewPct || JSON.stringify(packagingFeatures(a)).localeCompare(JSON.stringify(packagingFeatures(b))));
  const n = rows.length, p = PACKAGING_KEYS.length;
  const top = [...rows].sort((a, b) => b.ctr - a.ctr || b.avgViewPct - a.avgViewPct || a.title.localeCompare(b.title)).slice(0, Math.ceil(n / 4));
  const counts = new Map<string, number>();
  top.forEach((r) => tokens(r.title).forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1)));
  const keywords = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([word]) => word);
  const roots = rows.map((r) => Math.sqrt(r.impressions)), total = roots.reduce((a, b) => a + b, 0);
  const weights = roots.map((w) => w / total * n), vectors = rows.map((r) => packagingFeatures(r, keywords));
  const means = NEUTRAL.map((fallback, j) => {
    let sum = 0, weight = 0;
    vectors.forEach((v, i) => { if (v[j] !== null) { sum += v[j]! * weights[i]; weight += weights[i]; } });
    return weight ? sum / weight : fallback;
  });
  const y = rows.map((r) => logit(r.ctr)), meanY = n ? dot(y, weights) / n : logit(isShort ? 0.04 : 0.05);
  const model: PackagingModel = { isShort, mode: "prior", samples: n, keywords, means, weights: [...PRIOR],
    intercept: (meanY * n + logit(isShort ? 0.04 : 0.05) * 8) / (n + 8), noise: 1, weightSum: Math.max(1, n), effectiveSamples: n,
    inverse: Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => +(i === j))) };
  if (n < MIN_PACKAGING_ROWS) return model;
  const penalty = Number.isFinite(lambda) ? clamp(lambda, 1e-3, 1e6) : 2;
  const z = vectors.map((v) => v.map((x, j) => (x ?? means[j]) - means[j]));
  const gram = Array.from({ length: p }, () => new Array<number>(p).fill(0)), rhs = PRIOR.map((v) => penalty * v);
  z.forEach((v, k) => { for (let i = 0; i < p; i++) { rhs[i] += weights[k] * v[i] * (y[k] - meanY); for (let j = 0; j < p; j++) gram[i][j] += weights[k] * v[i] * v[j]; } });
  const inv = inverse(gram.map((r, i) => r.map((v, j) => v + (i === j ? penalty : 0)))), beta = inv.map((r) => dot(r, rhs));
  if (![...beta, ...inv.flat()].every(Number.isFinite)) return model;
  const effective = n * n / dot(weights, weights), df = Math.min(effective - 1, 1 + inv.reduce((sum, r, i) => sum + 1 - penalty * r[i], 0));
  const residual = z.reduce((sum, v, i) => sum + weights[i] * (y[i] - meanY - dot(v, beta)) ** 2, 0) / n;
  return { ...model, mode: "fitted", intercept: meanY, weights: beta, inverse: inv, effectiveSamples: effective,
    noise: Math.sqrt(Math.max(0.15 ** 2, residual * effective / Math.max(1, effective - df))) };
}

const LABELS = ["Title length", "A number in the title", "A question in the title", "A colon in the title", "Curiosity words", "First-person wording", "Capital-letter ratio", "Emoji count", "Words shared with your strongest titles", "Thumbnail face count", "Thumbnail word count", "Thumbnail contrast", "Thumbnail hue", "Thumbnail hue"];

/** Approximate 95% prediction interval: residual log-odds scatter plus ridge leverage, transformed back
 * to CTR. This is a model-based uncertainty range, not a calibrated guarantee or a causal lift estimate.
 * Missing thumbnail fields contribute zero; reasons compare features with this format's own baseline. */
export function predictPackaging(model: PackagingModel, candidate: PackagingCandidate): PackagingPrediction {
  const features = packagingFeatures(candidate, model.keywords), z = features.map((v, i) => (v ?? model.means[i]) - model.means[i]);
  const contributions = z.map((v, i) => v * model.weights[i]), prediction = model.intercept + contributions.reduce((a, b) => a + b, 0);
  const leverage = Math.max(0, 1 / model.weightSum + dot(z, model.inverse.map((row) => dot(row, z))));
  const width = 1.96 * model.noise * Math.sqrt(1 + leverage);
  // Hue uses two circular components but supplies only one explanation.
  const factors = contributions.map((value, i) => ({ value, i })).filter(({ i }) => features[i] !== null && i !== 13);
  const hue = factors.find((f) => f.i === 12);
  if (hue) hue.value += contributions[13];
  const reasons = factors.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.i - b.i).slice(0, 3).map(({ value, i }) =>
    `${LABELS[i]} ${Math.abs(value) < 1e-8 ? "is close to your usual baseline" : `${value > 0 ? "raises" : "lowers"} this estimate versus your baseline`}${model.mode === "prior" ? " (starting prior)" : ""}.`);
  return { predictedCtr: sigmoid(prediction), interval: { low: sigmoid(prediction - width), high: sigmoid(prediction + width) }, reasons };
}

/** Candidates are ranked within the requested format only. Equal predictions keep input order. */
export function rankPackaging(history: readonly PackagingHistory[], candidates: readonly PackagingCandidate[], isShort = false): RankedPackaging[] {
  const model = fitPackaging(history, isShort);
  return candidates.map((candidate, candidateIndex) => ({ ...predictPackaging(model, candidate), candidateIndex, title: candidate.title, mode: model.mode, samples: model.samples }))
    .sort((a, b) => b.predictedCtr - a.predictedCtr || a.candidateIndex - b.candidateIndex).map((row, i) => ({ ...row, rank: i + 1 }));
}
