// Per-purpose model routing for background Claude calls (quota saver). Pure, tested in tests/model-routing.test.ts.
// askClaude/askClaudeStream use it only when the caller passed no explicit model: an explicit model always wins.
// Only short, high-volume, parser-validated jobs run on Haiku, each with a retry on the default model when the Haiku
// answer fails its parser (see the call sites). Everything else keeps the default model.

/** Purposes (exact tags) that run on the fast model. */
export const FAST_PURPOSES: readonly string[] = [
  "clips.description", // 1-2 lines + hashtags, parsed by buildDescription, editable in the publish form
  "clips.suggest", // title + hook rewrite as JSON, parsed by parseSuggestion
  "scout.features", // feature scout: score a batch of public model/tool cards as JSON, parsed by parseScores (retry on the default model)
  "pulse.morning", "pulse.midday", "pulse.evening", // daily news briefings; citations are verified, a briefing with none is retried on the default model
];

/** Never routed by the table, whatever FAST_PURPOSES says: CORE answers, agents and their reviews, anything that drafts or
 *  sends to other people, security/safety checks, and the Opus-designated judgement calls. */
export const PROTECTED = /^(core|agent|business\.(send|draft|reply|outreach)|clips\.(engage|rank|study|autopublish|publish)|scout\.niche|security|guard|review|call|portfolio)\b|\.review$|\.guard$|\.check$/;

export function routeFast(purpose: string | undefined, enabled = true): boolean {
  return enabled && !!purpose && !PROTECTED.test(purpose) && FAST_PURPOSES.includes(purpose);
}

/** The model for a call: the caller's explicit one, else the fast model for table purposes, else undefined (= default). */
export function routedModel(model: string | undefined, purpose: string | undefined, fast: string, enabled = true): string | undefined {
  return model ?? (routeFast(purpose, enabled) ? fast : undefined);
}

const RETRYABLE_MODEL_ERR_RE = /\b(429|529|overloaded|rate\s*limit|too\s+many\s+requests|capacity|temporarily\s+unavailable|service\s+unavailable|high\s+demand|try\s+again\s+shortly)\b/i;

/** True when a model error is transient overload/rate-limit where trying a fallback model tier can recover mid-turn. */
export function isRetryableModelError(message: string): boolean {
  if (!message) return false;
  return RETRYABLE_MODEL_ERR_RE.test(message);
}

/**
 * Pick the next healthy fallback model tier when the primary model is overloaded or rate-limited.
 * - smart (e.g. opus) -> default (e.g. sonnet)
 * - default (e.g. sonnet) -> fast (e.g. haiku), ONLY when purpose is not PROTECTED
 * Returns null if no safe fallback model exists.
 */
export function fallbackModelFor(
  current: string | undefined,
  opts: { defaultModel: string; smartModel: string; fastModel: string; purpose?: string },
): string | null {
  const cur = (current ?? opts.defaultModel).trim().toLowerCase();
  const def = opts.defaultModel.trim().toLowerCase();
  const smart = opts.smartModel.trim().toLowerCase();
  const fast = opts.fastModel.trim().toLowerCase();
  if (cur === smart && def && def !== cur) return opts.defaultModel;
  const isProtected = !!opts.purpose && PROTECTED.test(opts.purpose);
  if (cur === def && !isProtected && fast && fast !== cur) return opts.fastModel;
  return null;
}
