// CORE step planning. Live test 2026-10-31 (research construction companies + add leads): one tool-choice step on the
// main model took 3 min 23 s — it re-read every earlier tool result in full and could think without a cap.
// Now: tool-choice steps after a read go to the fast model with a small thinking cap and trimmed old results; the turn's
// own model writes the final answer. Pure; tests in tests/core-steps.test.ts.
export type Tier = "fast" | "smart" | "deep";

/** The live "route" event for the model that actually runs: its tier label (the UI's Fast/Main/Deep) and its id. */
export const routeEvent = (model: string, m: { fast: string; smart: string }) =>
  ({ type: "route", model: (model === m.fast ? "fast" : model === m.smart ? "smart" : "deep") as Tier, id: model });

/** Thinking cap for an intermediate tool-choice step (the CLI's MAX_THINKING_TOKENS; 1024 is the API minimum). */
export const STEP_THINKING = 1024;
/** Newest tool results a tool-choice step sees in full; older ones are cut to their start. */
export const KEEP_FULL = 2;
const SUMMARY_CHARS = 600;
// Only after a read: a step after a write or a build (ws_write…) may itself write files, which stays on the turn's model.
const AFTER_READ = /^You called (?:web_search|fetch_url|read_news|read_more) /;

/** The tier one step runs on. Step 0 (often the answer itself), the last step and session/fast turns keep the turn's tier. */
export function stepTier(tier: Tier, o: { lastStep: string | undefined; last: boolean; session: boolean }): Tier {
  return tier !== "fast" && !o.last && !o.session && AFTER_READ.test(o.lastStep ?? "") ? "fast" : tier;
}

/** Tool results for a prompt: all in full for the answer; for a tool-choice step, older ones shortened (they were read already). */
export function stepsContext(steps: string[], planning: boolean): string[] {
  if (!planning) return steps;
  return steps.map((s, i) => i >= steps.length - KEEP_FULL || s.length <= SUMMARY_CHARS ? s : `${s.slice(0, SUMMARY_CHARS)}…[older result shortened here; you already read it in full]`);
}

/** Same tool + same input = same key (input keys sorted, so key order doesn't matter). */
export function callKey(tool: string, input: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return `${tool} ${JSON.stringify(stable(input ?? {}))}`;
}

/** Keep a successful result for reuse in this turn. A write makes earlier reads stale, so they are dropped (identical writes stay deduped). */
export function remember(done: Map<string, string>, tool: string, input: unknown, out: string, isWrite: (tool: string) => boolean): void {
  if (out.startsWith("Error:")) return;
  if (isWrite(tool)) for (const k of [...done.keys()]) if (!isWrite(k.slice(0, k.indexOf(" ")))) done.delete(k);
  done.set(callKey(tool, input), out);
}

export const reused = (out: string) => `(Same call already made in this task: its earlier result, not run again.)\n${out}`;

// Rough timing model (not a measurement): CLI boot + prompt read + thinking/output written at each tier's speed.
const SPEED: Record<Tier, { prefill: number; out: number }> = { fast: { prefill: 40_000, out: 150 }, smart: { prefill: 15_000, out: 60 }, deep: { prefill: 8_000, out: 35 } };
const BOOT_MS = 5_000;
export function estimateStepMs(o: { tier: Tier; inputChars: number; outputTokens: number; thinkingTokens: number }): number {
  const s = SPEED[o.tier];
  return Math.round(BOOT_MS + (o.inputChars / 4 / s.prefill) * 1000 + ((o.outputTokens + o.thinkingTokens) / s.out) * 1000);
}
