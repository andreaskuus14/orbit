// BUSINESS outreach scorecard: reply rate per angle and per segment (business type), with sample sizes, a simple significance
// hint and the next angle to try. Pure; tested in tests/outreach-score.test.ts. Sending stays the owner's own click.
import { TEMPLATES, type Stage, type Template } from "./business-pure.ts";

export type Sig = "few" | "better" | "worse" | "same";
export type Cell = { key: string; sent: number; replied: number; rate: number; low: number; high: number; sig: Sig };
type Row = { stage: Stage; template?: string | null; kind?: string };

export const MIN_N = 5; // below this per group the hint says "too few to tell"
const REPLIED: readonly Stage[] = ["replied", "pilot", "paying"];
const pct = (x: number) => Math.round(x * 100);

/** 95 % Wilson interval for k replies out of n, in %. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 100];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [pct(Math.max(0, (c - r) / d)), pct(Math.min(1, (c + r) / d))];
}

/** Two-proportion z-test of a group against everyone else: "better"/"worse" at p < 0.05, "same" otherwise, "few" when either side is small. */
export function compare(k1: number, n1: number, k2: number, n2: number): Sig {
  if (n1 < MIN_N || n2 < MIN_N) return "few";
  const p = (k1 + k2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return "same";
  const z = (k1 / n1 - k2 / n2) / se;
  return z > 1.96 ? "better" : z < -1.96 ? "worse" : "same";
}

function cells(rows: { key: string; replied: boolean }[], keys: string[]): Cell[] {
  const total = rows.length, totalK = rows.filter((r) => r.replied).length;
  return keys.map((key) => {
    const mine = rows.filter((r) => r.key === key), k = mine.filter((r) => r.replied).length, n = mine.length;
    const [low, high] = wilson(k, n);
    return { key, sent: n, replied: k, rate: n ? pct(k / n) : 0, low, high, sig: compare(k, n, totalK - k, total - n) };
  });
}

/** Sent = moved past "To contact" (lost counts as sent, not replied); replied = replied, pilot or paying. Untagged drafts count for segments only. */
export function scorecard(ps: Row[]): { angles: Cell[]; segments: Cell[]; next: { angle: Template; why: string } | null } {
  const sent = ps.filter((p) => p.stage !== "lead");
  const tagged = sent.filter((p) => (TEMPLATES as readonly unknown[]).includes(p.template)).map((p) => ({ key: p.template as string, replied: REPLIED.includes(p.stage) }));
  const seg = sent.map((p) => ({ key: (p.kind ?? "").trim().toLowerCase().slice(0, 40) || "unknown", replied: REPLIED.includes(p.stage) }));
  const segKeys = [...new Set(seg.map((s) => s.key))].sort((a, b) => seg.filter((s) => s.key === b).length - seg.filter((s) => s.key === a).length).slice(0, 8);
  const angles = cells(tagged, [...TEMPLATES]);
  return { angles, segments: cells(seg, segKeys), next: nextAngle(angles) };
}

/** Explore first (the least-tried angle until each has MIN_N sends), then the angle whose upper bound is highest (it could still be the best). */
export function nextAngle(angles: Cell[]): { angle: Template; why: string } | null {
  if (!angles.length) return null;
  const thin = [...angles].sort((a, b) => a.sent - b.sent)[0];
  if (thin.sent < MIN_N) return { angle: thin.key as Template, why: `only ${thin.sent} sent with this angle: send ${MIN_N - thin.sent} more to learn if it works` };
  const best = [...angles].sort((a, b) => b.high - a.high || b.rate - a.rate)[0];
  return { angle: best.key as Template, why: best.sig === "better" ? `${best.rate}% reply rate, clearly ahead of the others: keep using it`
    : `${best.rate}% so far (${best.replied}/${best.sent}); it could be as high as ${best.high}%, so it's the best bet to test next` };
}

export const SIG_LABEL: Record<Sig, string> = { few: "too few to tell", better: "likely better (p<0.05)", worse: "likely worse (p<0.05)", same: "could be chance" };
