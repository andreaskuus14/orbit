// Approval predictions (pure, tested in tests/predict.test.ts). IO: predict.ts; API: /api/predictions; UI: OrbitThinks.tsx
// (a hint on approval cards), ANALYTICS → Predictions, Profile → Autonomy (a suggestion only), and one line in the weekly review.
// Before he decides on a clip, agent proposal, outreach draft, memory hygiene suggestion, niche or deal, ORBIT guesses approve or
// reject from his own past decisions in that area and records the guess; once he decides, the guess is scored (hit rate, Brier).
// Model: naive Bayes over the same simple features the lessons loop uses (clip hook/length/layout…, proposal agent/kind, niche
// traits…), counts decayed by age (half-life 30 days), Laplace-smoothed, so every guess can name the feature that drove it.
// A recorded guess is never changed: scoring a guess that was edited after the fact would be dishonest.

export const AREAS = ["clips", "proposals", "drafts", "hygiene", "niches", "deals"] as const;
export type PArea = (typeof AREAS)[number];
export const AREA_LABEL: Record<PArea, string> = { clips: "Clips", proposals: "Agent proposals", drafts: "Outreach drafts", hygiene: "Memory hygiene", niches: "Niches", deals: "Deals" };
/** The autonomy area (autonomy-pure AREAS) a well-predicted area could move to "Do & report". */
export const AUTONOMY_OF: Record<PArea, string> = { clips: "studio-prepare", proposals: "research", drafts: "business-drafts", hygiene: "memory", niches: "research", deals: "deals" };

export type Feature = { key: string; label: string }; // key "agent=atlas", label as in "proposals from atlas"
export type Decision = { id: string; area: PArea; at: string; ok: boolean; f: Feature[] }; // f [] = unknown now (the guess kept them)
export type Item = { id: string; area: PArea; f: Feature[] };
export type Prediction = { id: string; area: PArea; at: string; p: number; why: string; f: Feature[]; outcome?: boolean; decidedAt?: string };
export type Store = { v: 1; users: Record<string, { preds: Prediction[] }> };

const DAY = 86_400_000;
export const HALF_LIFE = 30 * DAY, MAX_AGE = 180 * DAY;
export const MIN_HISTORY = 5; // decisions in an area before ORBIT guesses at all
export const P_MIN = 0.03, P_MAX = 0.97;
export const STALE = 30 * DAY; // an item that vanished undecided: its guess is dropped
export const KEEP = 365 * DAY, MAX_PREDS = 3000;
export const ELIGIBLE_N = 30, ELIGIBLE_HIT = 0.9;

const weight = (at: string, now: number) => { const t = Date.parse(at); return Number.isFinite(t) && now - t <= MAX_AGE ? 0.5 ** (Math.max(0, now - t) / HALF_LIFE) : 0; };

type Stat = { y: number; n: number; ry: number; rn: number; label: string }; // decayed yes/no weight, raw yes/no counts
export type Model = { Y: number; N: number; count: number; feats: Map<string, Stat> };

export function train(ds: Decision[], now: number): Model {
  const m: Model = { Y: 0, N: 0, count: 0, feats: new Map() };
  for (const d of ds) {
    const w = weight(d.at, now);
    if (!w) continue;
    m.count++;
    if (d.ok) m.Y += w; else m.N += w;
    for (const f of d.f) {
      const s = m.feats.get(f.key) ?? m.feats.set(f.key, { y: 0, n: 0, ry: 0, rn: 0, label: f.label }).get(f.key)!;
      if (d.ok) { s.y += w; s.ry++; } else { s.n += w; s.rn++; }
    }
  }
  return m;
}

/** P(approve) and the one feature that pushed hardest toward the guess, in words. null without enough history. */
export function predictOne(m: Model, f: Feature[]): { p: number; why: string } | null {
  if (m.count < MIN_HISTORY) return null;
  const prior = Math.log((m.Y + 1) / (m.N + 1));
  const parts = f.flatMap((x) => {
    const s = m.feats.get(x.key);
    return s && s.ry + s.rn ? [{ s, lo: Math.log(((s.y + 1) / (m.Y + 2)) / ((s.n + 1) / (m.N + 2))) }] : [];
  });
  // Features of one item overlap (a long clip is often also a long-hook clip), so they share one vote: scale by 1/sqrt(k).
  const lo = prior + parts.reduce((a, x) => a + x.lo, 0) / Math.sqrt(Math.max(1, parts.length));
  const p = Math.min(P_MAX, Math.max(P_MIN, 1 / (1 + Math.exp(-lo))));
  const dir = p >= 0.5 ? 1 : -1, top = parts.filter((x) => x.lo * dir > 0).sort((a, b) => b.lo * dir - a.lo * dir)[0];
  const rate = (y: number, n: number) => `${Math.round(y)} of ${Math.round(y + n)}`;
  const why = top ? `${top.s.label}: you approved ${rate(top.s.ry, top.s.rn)}` : `you approve ${Math.round((m.Y / (m.Y + m.N || 1)) * 100)}% here lately`;
  return { p: Math.round(p * 100) / 100, why };
}

/** One refresh: score guesses he has now decided, drop guesses for items that vanished, guess each new pending item once.
 *  Training uses his decisions plus decided guesses whose source no longer keeps the item's features (dismissed deals). */
export function step(preds: Prediction[], decisions: Decision[], pending: Item[], now: number): Prediction[] {
  const iso = new Date(now).toISOString(), dec = new Map(decisions.map((d) => [d.id, d])), live = new Set(pending.map((i) => i.id));
  const next: Prediction[] = [];
  for (const x of preds) {
    if (x.outcome !== undefined) { if (now - Date.parse(x.decidedAt ?? x.at) <= KEEP) next.push(x); continue; }
    const d = dec.get(x.id);
    if (d) next.push({ ...x, outcome: d.ok, decidedAt: Date.parse(d.at) > Date.parse(x.at) ? d.at : iso });
    else if (live.has(x.id) || now - Date.parse(x.at) < STALE) next.push(x);
  }
  const known = new Map(next.map((x) => [x.id, x]));
  const history = [...decisions.map((d) => (d.f.length ? d : { ...d, f: known.get(d.id)?.f ?? [] })),
    ...next.filter((x) => x.outcome !== undefined && !dec.has(x.id)).map((x) => ({ id: x.id, area: x.area, at: x.decidedAt!, ok: x.outcome!, f: x.f }))];
  const models = new Map<PArea, Model>();
  for (const it of pending) {
    if (known.has(it.id) || dec.has(it.id)) continue;
    const m = models.get(it.area) ?? models.set(it.area, train(history.filter((d) => d.area === it.area), now)).get(it.area)!;
    const g = predictOne(m, it.f);
    if (g) next.push({ id: it.id, area: it.area, at: iso, p: g.p, why: g.why, f: it.f });
  }
  return next.sort((a, b) => (b.decidedAt ?? b.at).localeCompare(a.decidedAt ?? a.at)).slice(0, MAX_PREDS);
}

// ---- scoring ----
export type AreaScore = { area: PArea; label: string; n: number; hits: number; hitRate: number | null; brier: number | null };
export type Bin = { from: number; to: number; n: number; meanP: number | null; rate: number | null };
export type Score = { days: number; n: number; hits: number; hitRate: number | null; brier: number | null; areas: AreaScore[]; bins: Bin[] };

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Brier score: mean squared gap between P(approve) and what happened (1/0). 0 is perfect, 0.25 is a coin flip. */
export const brier = (xs: { p: number; y: boolean }[]) => (xs.length ? r3(xs.reduce((a, x) => a + (x.p - (x.y ? 1 : 0)) ** 2, 0) / xs.length) : null);
export const isHit = (x: Pick<Prediction, "p" | "outcome">) => (x.p >= 0.5) === x.outcome;

/** Reliability table: guesses binned by P(approve); a calibrated model's approve rate matches meanP in each bin. */
export function bins(xs: { p: number; y: boolean }[], k = 5): Bin[] {
  return Array.from({ length: k }, (_, i) => {
    const from = i / k, to = (i + 1) / k, b = xs.filter((x) => x.p >= from && (x.p < to || (i === k - 1 && x.p <= 1)));
    return { from, to, n: b.length, meanP: b.length ? r3(b.reduce((a, x) => a + x.p, 0) / b.length) : null, rate: b.length ? r3(b.filter((x) => x.y).length / b.length) : null };
  });
}

/** Hit rate and Brier score over guesses he decided in the last `days`, overall and per area. */
export function score(preds: Prediction[], now: number, days = 7): Score {
  const done = preds.filter((x) => x.outcome !== undefined && now - Date.parse(x.decidedAt!) <= days * DAY);
  const sum = (xs: Prediction[]) => ({ n: xs.length, hits: xs.filter(isHit).length, hitRate: xs.length ? r3(xs.filter(isHit).length / xs.length) : null, brier: brier(xs.map((x) => ({ p: x.p, y: x.outcome! }))) });
  return { days, ...sum(done), areas: AREAS.map((a) => ({ area: a, label: AREA_LABEL[a], ...sum(done.filter((x) => x.area === a)) })).filter((a) => a.n),
    bins: bins(done.map((x) => ({ p: x.p, y: x.outcome! }))) };
}

/** Areas whose last ELIGIBLE_N decided guesses hit at least ELIGIBLE_HIT: a suggestion for Do & report, never a switch. */
export function eligible(preds: Prediction[]): { area: PArea; label: string; autonomy: string; hits: number; n: number }[] {
  return AREAS.flatMap((a) => {
    const last = preds.filter((x) => x.area === a && x.outcome !== undefined).sort((x, y) => y.decidedAt!.localeCompare(x.decidedAt!)).slice(0, ELIGIBLE_N);
    const hits = last.filter(isHit).length;
    return last.length === ELIGIBLE_N && hits / ELIGIBLE_N >= ELIGIBLE_HIT ? [{ area: a, label: AREA_LABEL[a], autonomy: AUTONOMY_OF[a], hits, n: ELIGIBLE_N }] : [];
  });
}

/** The card hint: "ORBIT thinks: approve, 87%". */
export const hintText = (x: Pick<Prediction, "p">) => `ORBIT thinks: ${x.p >= 0.5 ? "approve" : "reject"}, ${Math.round((x.p >= 0.5 ? x.p : 1 - x.p) * 100)}%`;

/** One line for the weekly review ("" when nothing was decided this week). */
export function weeklyLine(s: Score): string {
  if (!s.n) return "";
  return `ORBIT guessed ${s.n} of your decisions before you made them: ${s.hits} right (${Math.round((s.hitRate ?? 0) * 100)}%), Brier ${s.brier?.toFixed(2)} (0 is perfect, 0.25 a coin flip).`;
}

export function parseStore(text: string): Store | null {
  if (!text.trim()) return { v: 1, users: {} };
  try {
    const s = JSON.parse(text) as Store;
    if (s?.v !== 1 || !s.users || typeof s.users !== "object") return null;
    for (const u of Object.values(s.users)) if (!Array.isArray(u?.preds)) return null;
    return s;
  } catch { return null; }
}
