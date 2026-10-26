// CORE capability helpers: the tool-step cap, honest failure text, fallback notes and the DEV "CORE config" readout.
// Pure (no imports with side effects): tested in tests/core-capability.test.ts. See docs/CORE-CAPABILITY.md.

/** Model calls per CORE turn (the last one must answer). ORBIT_CORE_MAX_STEPS, default 8, clamped 2..12;
 *  the turn's 270 s time budget (core.ts) still forces an answer earlier when time runs short. */
export function maxSteps(env: string | undefined): number {
  const n = Math.floor(Number(env));
  return Number.isFinite(n) && n > 0 ? Math.min(12, Math.max(2, n)) : 8;
}

/** A visible line when this answer came from a weaker setup than chosen (deep → main model), else "". */
export function fallbackNote(trace: { step: string; detail: string }[]): string {
  const f = trace.find((s) => s.step === "fallback" && s.detail.startsWith("deep →"));
  return f ? `\n\n_Note: answered without the deep model (${f.detail.replace(/^deep → main model\s*/, "").replace(/^\(|\)$/g, "") || "it failed"})._` : "";
}

/** What the user is told when a CORE turn fails: says plainly whether it was the login, a usage limit, a timeout or Claude being missing. */
export function describeFailure(msg: string): string {
  const m = msg.slice(0, 400);
  if (/usage limit|hit your limit|rate_limit|API Error: 429|rate limit (?:reached|exceeded)/i.test(m)) return `Claude usage limit reached, so CORE could not answer. ${m.match(/resets?[^.\n]*/i)?.[0] ?? "Try again later."}`.trim();
  if (/\/login|not logged in|invalid api key|oauth token|token (?:has )?expired|authentication|unauthori[sz]ed|401/i.test(m)) return "Claude login expired or missing on the ORBIT PC: run `claude` there and sign in again (/login). CORE did not answer.";
  if (/timed out/i.test(m)) return `${m} CORE did not finish; nothing after the last completed step was done.`;
  if (/Could not start|ENOENT/i.test(m)) return `Claude Code is not reachable: ${m}`;
  return m || "CORE failed";
}

export type CoreConfig = {
  auth: string; bin: string; models: { main: string; fast: string; deep: string; smart: string }; deepEffort: string;
  maxSteps: number; toolResultChars: number; historyFull: number; turnBudgetS: number; callTimeoutS: number; concurrency: number;
  session: string; tools: string; voice: string;
};
