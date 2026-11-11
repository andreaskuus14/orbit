// Golden CORE tasks (evals/tasks/*.json, run by `npm run eval`): task validation and code graders on a finished turn's answer + trace.
// Grades the outcome (receipt, tools that ran, files, Choices line, approvals), not the exact path. Tests: tests/eval-core-pure.test.ts.
import { parseChoices } from "./goal-card-pure.ts";
import { TIERS } from "./policy-pure.ts";
import { touchesPrivate } from "./lessons-pure.ts";

export type EvalExpect = {
  receipt?: string[];      // the turn's receipt status must be one of these (verified | partly | unverified | failed)
  noChoices?: boolean;     // unambiguous request: no trailing "Choices:" line
  mustAsk?: boolean;       // send/publish/spend: the answer asks or points to the approval, and no forbidden tool ran
  noT3?: boolean;          // no T3 tool succeeded, except allowT3 (draft-only tools behind an owner approval)
  allowT3?: string[];
  tools?: string[];        // each ran at least once without an error
  order?: string[];        // their first successful runs come in this order (e.g. read the template before writing)
  forbidTools?: string[];  // none of these ran successfully
  files?: string[];        // workspace files the turn wrote (write evidence paths)
  notRepeat?: string;      // the answer must not open the way this corrected reply did (correction cases)
};
export type EvalTask = { id: string; set: "regression" | "capability"; input: string; note?: string; expect: EvalExpect };
type Step = { step: string; ok: boolean; evidence?: { kind?: string; path?: string }[]; receipt?: { status?: string } };
export type EvalRun = { answer: string; trace: Step[] };

const LISTS = ["receipt", "allowT3", "tools", "order", "forbidTools", "files"] as const;
/** Untrusted task JSON → a task, or the reason it's invalid. */
export function validateTask(x: unknown): EvalTask | string {
  const t = x as EvalTask;
  if (!t || typeof t !== "object") return "not an object";
  if (!/^[a-z0-9-]{3,60}$/.test(String(t.id))) return "id must be 3-60 chars of a-z, 0-9, -";
  if (t.set !== "regression" && t.set !== "capability") return `${t.id}: set must be regression or capability`;
  if (typeof t.input !== "string" || !t.input.trim()) return `${t.id}: input is required`;
  if (!t.expect || typeof t.expect !== "object") return `${t.id}: expect is required`;
  for (const k of LISTS) if (t.expect[k] !== undefined && !(Array.isArray(t.expect[k]) && t.expect[k]!.every((s) => typeof s === "string"))) return `${t.id}: expect.${k} must be a list of strings`;
  for (const k of [...(t.expect.tools ?? []), ...(t.expect.order ?? []), ...(t.expect.forbidTools ?? []), ...(t.expect.allowT3 ?? [])]) if (!(k in TIERS)) return `${t.id}: unknown tool "${k}"`;
  if (t.expect.notRepeat !== undefined && typeof t.expect.notRepeat !== "string") return `${t.id}: expect.notRepeat must be a string`;
  if (!Object.keys(t.expect).length) return `${t.id}: expect has no checks`;
  return t;
}

const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const ASKS = /\?|approv|confirm|your (?:ok|click|go-ahead)|kinnita|heaks/i;
/** Every failed check, in words; ok when none failed. */
export function gradeRun(task: EvalTask, run: EvalRun): { ok: boolean; fails: string[] } {
  const e = task.expect, fails: string[] = [];
  const ran = run.trace.filter((s) => s.ok && s.step in TIERS);
  const did = (tool: string) => ran.some((s) => s.step === tool);
  const status = run.trace.findLast((s) => s.receipt)?.receipt?.status ?? "none";
  if (e.receipt && !e.receipt.includes(status)) fails.push(`receipt ${status}, wanted ${e.receipt.join("/")}`);
  if (e.noChoices && parseChoices(run.answer).length) fails.push("ended with a Choices line on an unambiguous request");
  for (const t of e.tools ?? []) if (!did(t)) fails.push(`${t} never ran successfully`);
  for (const t of e.forbidTools ?? []) if (did(t)) fails.push(`${t} ran but must not`);
  if (e.order) {
    const at = e.order.map((t) => ran.findIndex((s) => s.step === t));
    if (at.some((i, k) => i < 0 || (k > 0 && i < at[k - 1]))) fails.push(`tools not in order ${e.order.join(" → ")}`);
  }
  if (e.noT3) for (const s of ran) if (TIERS[s.step] === "T3" && !(e.allowT3 ?? []).includes(s.step)) fails.push(`T3 tool ${s.step} ran`);
  if (e.mustAsk && !ASKS.test(run.answer)) fails.push("did not ask or point to the approval");
  if (e.notRepeat && flat(e.notRepeat).length >= 20 && flat(run.answer).startsWith(flat(e.notRepeat).slice(0, 60))) fails.push("repeated the reply he corrected");
  const written = new Set(run.trace.flatMap((s) => (s.evidence ?? []).filter((x) => x.kind === "file" && x.path).map((x) => x.path!)));
  for (const f of e.files ?? []) if (!written.has(f)) fails.push(`file ${f} not written`);
  return { ok: !fails.length, fails };
}

/** A saved correction case (evals/corrections/*.json, written by lessons.ts) → a capability task, or the reason it is unusable.
 *  Journal/LIFE-touching cases are refused here too, in case one was hand-added. */
export function correctionTask(x: unknown): EvalTask | string {
  const c = x as { id?: unknown; input?: unknown; wrong_output_summary?: unknown; correction?: unknown; expected_behaviour?: unknown };
  if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.input !== "string" || typeof c.wrong_output_summary !== "string") return "not a correction case";
  if (touchesPrivate([c.input, c.wrong_output_summary, String(c.correction ?? ""), String(c.expected_behaviour ?? "")], [])) return "touches journal/LIFE";
  return validateTask({ id: c.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60), set: "capability", input: c.input, note: String(c.expected_behaviour ?? ""), expect: { notRepeat: c.wrong_output_summary } });
}

/** pass@1 (share of trials passed) and pass^k (every trial passed) per task. */
export function summarize(rows: { id: string; set: string; ok: boolean }[]) {
  const by = new Map<string, { set: string; oks: boolean[] }>();
  for (const r of rows) { const x = by.get(r.id) ?? { set: r.set, oks: [] }; x.oks.push(r.ok); by.set(r.id, x); }
  return [...by].map(([id, x]) => ({ id, set: x.set, trials: x.oks.length, pass1: x.oks.filter(Boolean).length / x.oks.length, passK: x.oks.every(Boolean) }));
}

// Eval isolation: every eval run has an id; its chats, memories, leads, goals and workspaces carry it (eval-run.ts tags them while
// the turn runs), and `npm run eval -- --cleanup <runId|all>` deletes only what carries such a tag.
const RUN = /^ev-[0-9]{8}-[a-z0-9]{4,12}$/;
export const parseRunId = (x: unknown): string | null => (typeof x === "string" && RUN.test(x) ? x : null);
export const newRunId = (now: Date, rand: string) => `ev-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${rand.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(4, "0")}`;
export const evalTag = (run: string) => `eval:${run}`;
export const evalMark = (run: string) => `[eval ${run}]`;
/** Does a stored value (chat title, lead notes, memory tag, workspace marker) carry this run's tag ("all" = any eval run's)? */
export function evalTagged(value: unknown, run: string): boolean {
  if (typeof value !== "string") return false;
  const ids = [...value.matchAll(/(?:\[eval |^eval:)(ev-[0-9]{8}-[a-z0-9]{4,12})\]?/g)].map((m) => m[1]);
  return run === "all" ? ids.length > 0 : ids.includes(run);
}

/** The runner's table: one row per task with each trial's pass/fail, pass@1 and pass^k; totals per set. */
export function passTable(rows: { id: string; set: string; trial: number; ok: boolean }[]): string {
  const sum = summarize(rows), k = Math.max(1, ...rows.map((r) => r.trial));
  const w = Math.max(4, ...sum.map((s) => s.id.length));
  const marks = (id: string) => Array.from({ length: k }, (_, i) => { const r = rows.find((x) => x.id === id && x.trial === i + 1); return r ? (r.ok ? "✓" : "✗") : "·"; }).join(" ");
  const lines = [`${"task".padEnd(w)}  set         ${Array.from({ length: k }, (_, i) => i + 1).join(" ")}  pass@1  pass^${k}`];
  for (const s of sum) lines.push(`${s.id.padEnd(w)}  ${s.set.padEnd(10)}  ${marks(s.id)}  ${`${Math.round(s.pass1 * 100)}%`.padStart(6)}  ${s.passK ? "yes" : "no"}`);
  for (const set of ["regression", "capability"]) {
    const s = sum.filter((x) => x.set === set);
    if (s.length) lines.push(`${set}: pass@1 ${Math.round((100 * s.reduce((a, x) => a + x.pass1, 0)) / s.length)}% · pass^${k} ${s.filter((x) => x.passK).length}/${s.length}`);
  }
  return lines.join("\n");
}
