// Keeps the last Claude call of an agent task for its answer. web_search and delegate spend the same budget, so on the live PC
// (scorecard 8 Nov) Atlas spent its last call on a search and delivered a stopped-task log instead of the comparison.

export type CallBudget = { calls: number; used: number };

export const NO_CALL_FOR_TOOLS = "Error: only one call is left in this task's budget, kept for your answer. Use no more tools: reply now with \"final\" using what you found, and say what you could not check.";

/** A tool may run only while more than the answer's call remains. */
export const toolAllowed = (b: CallBudget) => b.calls - b.used > 1;

/** Runs a tool with the answer's call held back, so the tool (or a delegated sub-task) can't spend it. */
export async function holdAnswerCall<T>(b: CallBudget, run: () => Promise<T>): Promise<T> {
  b.calls--;
  try { return await run(); } finally { b.calls++; }
}
