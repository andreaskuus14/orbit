// Local fact check: DeBERTa-v3-base NLI (MIT) in one child process (factcheck-worker.mjs via asr-pool.ts createPool), never in
// the Next server. On by default; ORBIT_FACTCHECK=0 turns it off. Any failure, a cold model or the time budget running out
// returns null and the caller keeps today's text. Pure logic and the briefing/CORE text changes: factcheck-pure.ts.
import path from "node:path";
import { createPool } from "./asr-pool";
import { checkPairs, factcheckOn, type Claim, type Nli, type Source, type Verdict } from "./factcheck-pure";

const MODEL = () => process.env.ORBIT_FACTCHECK_MODEL || "Xenova/DeBERTa-v3-base-mnli-fever-anli";
const IDLE_MS = 10 * 60_000; // the model (~500 MB RAM) leaves memory after 10 idle minutes
const LOAD_MS = 30 * 60_000; // first use downloads ~240 MB

type Pool = ReturnType<typeof createPool>;
const G = globalThis as unknown as { __orbitFact?: { pool: Pool; loaded?: Promise<boolean>; idle?: ReturnType<typeof setTimeout> } };

function state() {
  let s = G.__orbitFact;
  if (!s || s.pool.dead) s = G.__orbitFact = { pool: createPool(path.join(process.cwd(), "src/lib/factcheck-worker.mjs"), 1, 30_000, "Fact check") };
  return s;
}
const cacheDir = () => path.join(process.cwd(), ".cache", "transformers");
const sleep = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms).unref?.());

function touch(s: NonNullable<typeof G.__orbitFact>) {
  clearTimeout(s.idle);
  s.idle = setTimeout(() => { if (G.__orbitFact === s) { G.__orbitFact = undefined; s.pool.close(); } }, IDLE_MS);
  s.idle.unref?.();
}

/** Scores per pair, or null (off, failed, not loaded within the budget). Loading goes on in the background after a timeout. */
async function score(pairs: [string, string][], budgetMs: number): Promise<(Nli | null)[] | null> {
  if (!factcheckOn(process.env) || !pairs.length) return null;
  const end = Date.now() + budgetMs;
  try {
    const s = state();
    touch(s);
    s.loaded ??= s.pool.run({ model: MODEL(), cacheDir: cacheDir() }, LOAD_MS).then(() => true, (e) => { console.error("[orbit] fact check model unavailable:", e instanceof Error ? e.message : e); s.loaded = undefined; return false; });
    if (!(await Promise.race([s.loaded, sleep(budgetMs)]))) return null;
    const ms = end - Date.now();
    if (ms < 500) return null;
    const r = await s.pool.run({ model: MODEL(), cacheDir: cacheDir(), pairs, ms }, ms + 15_000) as (Nli | null)[];
    touch(s);
    return Array.isArray(r) && r.length === pairs.length ? r : null;
  } catch (e) {
    console.error("[orbit] fact check failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Verdict per claim key, or null when the check didn't run (then nothing in the text changes). */
export async function checkClaimsLocal(claims: Claim[], sources: Map<string, Source>, budgetMs: number): Promise<{ v: Map<number, Verdict>; ms: number; pairs: number } | null> {
  const t = Date.now();
  const { pairs, decide } = checkPairs(claims, sources); // each claim whole and fact by fact, across every source it cites
  if (!pairs.length) return null;
  const scores = await score(pairs.map((p) => [p.premise, p.hypothesis]), budgetMs);
  return scores ? { v: decide(scores), ms: Date.now() - t, pairs: pairs.length } : null;
}

/** Time budget for a briefing's check (it runs in the background job) and for a CORE answer (the owner is waiting). */
export const briefingBudgetMs = () => Math.max(2_000, Number(process.env.ORBIT_FACTCHECK_MS) || 45_000);
export const coreBudgetMs = () => Math.max(1_000, Number(process.env.ORBIT_FACTCHECK_CORE_MS) || 6_000);
