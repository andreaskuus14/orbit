// Long CORE work (owner report: "Claude Code timed out because CORE didn't finish in 2 min"). Pure; tests in tests/long-work.test.ts.
// One CLI call gets a limit by purpose: quick chat stays short, generation-heavy steps (site files, research, agents) get minutes.
// A timed-out call is retried once with the work split; if the interactive turn still can't finish, the rest runs in the background.
import type { Lang } from "./i18n-pure.ts";

export const CHAT_MS = 120_000;
export const GEN_MS = 9 * 60_000;
export const CAP_MS = 10 * 60_000; // no single call ever runs longer
export const BACKGROUND_TURN_MS = 20 * 60_000; // a handed-off turn's whole budget
const MARGIN_MS = 15_000; // left for the tool and the answer after a call

const HEAVY_Q = /\b(?:build|make|create|write|generate|redesign|rewrite)\b[\s\S]{0,80}\b(?:site|website|web ?page|app|game|files?|landing|portfolio)\b|\b(?:research|deep dive|investigate|report on)\b|\b(?:ehita|loo|tee)\b[\s\S]{0,60}(?:veebileh|lehe|äpp|mäng)|\buuri(?:mus)?\b/i;
const HEAVY_TOOL = /^You called (?:ws_write|ws_create|ask_agent|web_search|start_mission) /;

/** Generation-heavy: the question asks to build/research, or the last step was a file write, an agent or research. */
export function isHeavy(question: string, steps: string[]): boolean {
  return HEAVY_Q.test(question) || HEAVY_TOOL.test(steps.at(-1) ?? "");
}

/** One call's limit: by purpose, never past what's left of the turn (minus a margin) or CAP_MS; at least 20 s. */
export function callTimeout(heavy: boolean, leftMs: number): number {
  return Math.max(20_000, Math.min(heavy ? GEN_MS : CHAT_MS, CAP_MS, leftMs - MARGIN_MS));
}

export const isTimeout = (e: unknown) => /timed out|time limit|aborted due to timeout|TimeoutError/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/** After a timed-out call: retry once (split) while ≥ 90 s are left, else hand the turn off to the background. */
export function afterTimeout(retried: boolean, leftMs: number): "retry" | "handoff" {
  return !retried && leftMs >= 90_000 ? "retry" : "handoff";
}

/** Chunking plan for a site of n files: ≤ 3 ws_write calls, files split evenly in order. */
export function chunkPlan(n: number): number[] {
  if (n <= 0) return [];
  const calls = Math.min(3, Math.max(1, Math.ceil(n / 3)));
  return Array.from({ length: calls }, (_, i) => Math.floor((n * (i + 1)) / calls) - Math.floor((n * i) / calls));
}

/** Told to the model on the retry after a timeout. */
export const SPLIT_HINT = "YOUR LAST REPLY TIMED OUT (too much in one call). Do the work in smaller pieces: write a site's files in 2-3 ws_write calls (at most 3, a few files each, index.html last so the headless check runs on the finished site), and keep research answers short.";

/** Progress label for a long step ("Writing 6 files…"); null when the generic label is fine. */
export function progressLabel(tool: string, input: Record<string, unknown>): string | null {
  if (tool === "ws_write") { const n = Array.isArray(input.files) ? input.files.length : 0; return n ? `Writing ${n} file${n === 1 ? "" : "s"}…` : "Writing files…"; }
  if (tool === "ws_create") return "Creating the workspace…";
  return null;
}

/** The immediate chat reply when the turn moves to the background; links the task in OPERATIONS (deep link). */
export function handoffReply(taskId: string, lang: Lang): string {
  const link = `#o=operations&k=task&id=${taskId}`;
  return lang === "et"
    ? `Töötan selle kallal taustal. Annan teada, kui valmis. [Ava OPERATIONS-is](${link})`
    : `Working on it in the background — I'll notify you when it's done. [Open in OPERATIONS](${link})`;
}

/** Never show the raw CLI timeout as the owner's final answer. */
export const BG_FAILED = "The background run didn't finish. Ask again, or split the request into smaller parts.";
