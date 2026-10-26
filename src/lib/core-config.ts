import { CLAUDE_BIN, MODEL, FAST_MODEL, DEEP_MODEL, SMART_MODEL, DEEP_EFFORT, TIMEOUT_MS, MAX_CLI } from "./claude";
import { MAX_STEPS } from "./core";
import type { CoreConfig } from "./core-capability-pure";

/** The effective CORE setup, for the DEV world's "CORE config" readout (GET /api/core). No secrets: only whether a key is set. */
export function coreConfig(): CoreConfig {
  return {
    auth: process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY is set: the CLI bills the API key, not the Claude login" : "Claude Code CLI login (subscription; no API key)",
    bin: CLAUDE_BIN,
    models: { main: MODEL, fast: FAST_MODEL, deep: DEEP_MODEL, smart: SMART_MODEL },
    deepEffort: DEEP_EFFORT || "off",
    maxSteps: MAX_STEPS,
    toolResultChars: 8000,
    historyFull: 8,
    turnBudgetS: 270,
    callTimeoutS: TIMEOUT_MS / 1000,
    concurrency: MAX_CLI,
    session: "stateless: one `claude -p --no-session-persistence` per step; history, memories and tool results are re-sent in each prompt",
    tools: "CORE's own JSON tool loop (CLI tools off; web_search runs a separate CLI call with WebSearch/WebFetch only)",
    voice: "on-screen voice: only the first paragraph is spoken, full answer stays on screen; phone call: short replies, no deep tier",
  };
}
