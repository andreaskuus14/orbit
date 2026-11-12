// GAME DEV R1: persona predictions vs the owner's real Roblox analytics. Pure; tested in tests/persona-calibration.test.ts.
// The personas only produce a funnel (who reaches which milestone), so the metric predictions below are explicit, simple mappings of it.
// The factor per metric is real / predicted, shrunk toward 1 for small samples. It is a fit to ONE import: it moves the scale, it does
// not make the personas right, and the compared quantities are only loosely the same thing (see gd.cal.mapping). Never causal.
import { STAGES, STAGE_LABEL, funnel, type PersonaResult, type Stage } from "./personas-pure.ts";
import { SMALL_SAMPLE, cohorts, funnelRates, type Retention } from "./gamedev-retention-pure.ts";

export const MIN_PER_STAGE = 2; // assumption: minutes a persona plays per milestone it reaches (+1 for the first); factors absorb the error
export const MIN_FACTOR = 0.1, MAX_FACTOR = 10;

export type Unit = "rate" | "min";
export type Metric = { key: string; label: string; unit: Unit; est?: true }; // est: derived from an assumed mapping, not a direct measure
export type Row = Metric & { raw: number; real: number | null; n: number; error: number | null; factor: number | null; calibrated: number };
export type Factors = Record<string, { factor: number; n: number }>;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const STEP_RE: Record<Stage, RegExp> = { join: /\bjoin|visit|spawn|start/i, first_pet: /first (pet|egg)|hatch/i, first_upgrade: /upgrade/i, rebirth: /rebirth/i };

/** What the personas predicted, per metric (rates 0-1, session in minutes). */
export function predict(results: PersonaResult[]): Record<string, number> {
  const n = results.length || 1, f = funnel(results), at = (s: Stage) => f.find((x) => x.stage === s)!.reached / n;
  const reachedCount = (r: PersonaResult) => (r.reached ? STAGES.indexOf(r.reached) + 1 : 0);
  return { d1: at("first_upgrade"), d7: at("rebirth"), minutes: MIN_PER_STAGE * (results.reduce((a, r) => a + reachedCount(r), 0) / n + 1),
    ...Object.fromEntries(STAGES.map((s) => [`funnel.${s}`, at(s)])) };
}

/** Session minutes weighted by each day's new users (days without a value are left out). */
function weightedMinutes(r: Pick<Retention, "rows">): { v: number | null; n: number } {
  const rows = r.rows.filter((x) => x.minutes !== undefined), n = rows.reduce((a, x) => a + x.users, 0);
  return { v: n > 0 ? r3(rows.reduce((a, x) => a + x.minutes! * x.users, 0) / n) : null, n };
}

/** The real numbers from an import: user-weighted D1/D7 over mature days, user-weighted mean session minutes, funnel shares of the first step. null = unknown. */
export function actuals(r: Retention): Record<string, { v: number | null; n: number }> {
  const c = cohorts(r, [])[0], out: Record<string, { v: number | null; n: number }> = {
    d1: { v: c?.d1.value ?? null, n: c?.d1.n ?? 0 }, d7: { v: c?.d7.value ?? null, n: c?.d7.n ?? 0 }, minutes: weightedMinutes(r) };
  const fr = funnelRates(r.funnel);
  for (const s of STAGES) { const hit = fr.find((x) => x.step.toLowerCase().includes(STAGE_LABEL[s].toLowerCase()) || STEP_RE[s].test(x.step)); out[`funnel.${s}`] = { v: hit ? hit.fromStart / 100 : null, n: fr[0]?.users ?? 0 }; }
  return out;
}

export const METRICS: Metric[] = [{ key: "d1", label: "D1 retention", unit: "rate", est: true }, { key: "d7", label: "D7 retention", unit: "rate", est: true }, { key: "minutes", label: "Avg session (min)", unit: "min", est: true },
  ...STAGES.map((s): Metric => ({ key: `funnel.${s}`, label: `Funnel: ${STAGE_LABEL[s]}`, unit: "rate" }))];

/** Shrunk ratio real / predicted; null when either side is unusable. */
export function factorFor(raw: number, real: number | null, n: number): number | null {
  if (real === null || !(raw > 0) || !(n > 0)) return null;
  const f = 1 + (real / raw - 1) * (n / (n + SMALL_SAMPLE));
  return r3(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, f)));
}

export const calibrate = (raw: number, factor: number | undefined, unit: Unit) => r3(unit === "rate" ? Math.min(1, raw * (factor ?? 1)) : raw * (factor ?? 1));

/** Per metric: raw prediction, real value, error (raw - real, same unit) and the factor this import implies; calibrated = raw x `use` (default: the new factors). */
export function compare(results: PersonaResult[], real: Retention, use?: Factors): { rows: Row[]; factors: Factors } {
  const raw = predict(results), act = actuals(real), factors: Factors = {};
  const rows = METRICS.map((m): Row => {
    const r = r3(raw[m.key]), a = act[m.key], f = factorFor(r, a.v, a.n);
    if (f !== null) factors[m.key] = { factor: f, n: a.n };
    return { ...m, raw: r, real: a.v, n: a.n, error: a.v === null ? null : r3(r - a.v), factor: f, calibrated: calibrate(r, (use ?? factors)[m.key]?.factor, m.unit) };
  });
  return { rows, factors };
}

export function cleanFactors(v: unknown): Factors {
  const out: Factors = {};
  if (v && typeof v === "object") for (const m of METRICS) {
    const x = (v as Record<string, unknown>)[m.key] as { factor?: unknown; n?: unknown } | undefined;
    if (x && typeof x.factor === "number" && typeof x.n === "number" && x.factor >= MIN_FACTOR && x.factor <= MAX_FACTOR && x.n > 0) out[m.key] = { factor: x.factor, n: x.n };
  }
  return out;
}

/** Same game for the UI and the server: the one the owner picked, else the pet sim, else the first Roblox game, else the first game. */
export function pickGame<G extends { id: string; platform?: string }>(games: G[], preferred?: unknown): G | undefined {
  return games.find((x) => x.id === preferred) ?? games.find((x) => x.id === "pet-sim") ?? games.find((x) => x.platform === "roblox") ?? games[0];
}

/** A calibration that can't be done with what the owner has (nothing to fit) is the owner's to fix: 409. Anything else, e.g. storage, is ours: 500. */
export class CalibrationError extends Error {}
export const calibrationStatus = (e: unknown) => (e instanceof CalibrationError ? 409 : 500);
