// CORE's context lookups (memories, chat summaries, facts, world, people...) run in parallel before the first model step. One slow
// lookup (a cold database connection after the laptop woke, the local embedding model still loading) used to hold the whole
// prompt, so the first words came ~10 s late. Each lookup now gets a time budget: late = left out of this turn (CORE answers
// with less context) instead of waiting. Pure; core.ts wires it. ORBIT_PREP_BUDGET_MS (default 2500, 0 = no budget).

export const PREP_BUDGET_MS = 2_500;
/** The local embedding model may still be loading (first search after a start): a query waits at most this long for its vector,
 *  then the search runs on keywords only (full text) and the model keeps loading for the next turn. */
export const COLD_EMBED_MS = 1_200;

export function prepBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return PREP_BUDGET_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 60_000) : PREP_BUDGET_MS;
}

/** p, or `fallback` once ms passed (onLate is told). ms <= 0: no budget. A rejection still rejects (callers keep their own catch). */
export function withBudget<T>(p: PromiseLike<T>, ms: number, fallback: T, onLate?: () => void): Promise<T> {
  if (!(ms > 0)) return Promise.resolve(p);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => { onLate?.(); resolve(fallback); }, ms); });
  return Promise.race([Promise.resolve(p), late]).finally(() => clearTimeout(timer));
}

/** The trace line for lookups left out of a turn: "chats, memory took over 2.5 s; answered without them". */
export const lateLine = (late: string[], ms: number) => late.length ? `${[...new Set(late)].sort().join(", ")} took over ${(ms / 1000).toFixed(1)} s; answered without ${late.length > 1 ? "them" : "it"}` : "";
