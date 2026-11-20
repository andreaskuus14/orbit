// Per-purpose model routing for background Claude calls (quota saver). Pure, tested in tests/model-routing.test.ts.
// askClaude/askClaudeStream use it only when the caller passed no explicit model: an explicit model always wins.
// Only short, high-volume, parser-validated jobs run on Haiku, each with a retry on the default model when the Haiku
// answer fails its parser (see the call sites). Everything else keeps the default model.

/** Purposes (exact tags) that run on the fast model. */
export const FAST_PURPOSES: readonly string[] = [
  "clips.description", // 1-2 lines + hashtags, parsed by buildDescription, editable in the publish form
  "clips.suggest", // title + hook rewrite as JSON, parsed by parseSuggestion
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
