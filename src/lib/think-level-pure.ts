// Thinking levels for a CORE answer: quick / normal / deep, one word on the answer. Pure (server, tests, browser).
// quick = the routed fast model, no tools unless it reaches for one (then it is redone on the main model);
// normal = the main model; deep = the deep model (Opus) with --effort (extended thinking), a private plan and one self-check.
// Auto picks from the request; the owner can override per message. The usage pacer decides whether deep is allowed:
// auto-deep only while the 5-hour window is under the warning line, a chosen deep until the window is full or a real limit hits.
// Safety asks (auth/money/approvals/sending) always run deep: that floor is about Opus, not about speed, so no override lowers it.
// Never Fable: levels name tiers only; the models behind them come from claude.ts (FAST/MAIN/DEEP, none of them Fable).
import { pickModel } from "./core-ui.ts";

export type Level = "quick" | "normal" | "deep";
export type LevelChoice = Level | "auto";
export type Tier = "fast" | "smart" | "deep";
export const LEVELS: readonly Level[] = ["quick", "normal", "deep"];
export const CHOICES: readonly LevelChoice[] = ["auto", "quick", "normal", "deep"];

export const levelOfTier = (t: string | undefined): Level | null => (t === "fast" ? "quick" : t === "smart" ? "normal" : t === "deep" ? "deep" : null);
export const tierOfLevel = (l: Level): Tier => (l === "quick" ? "fast" : l === "deep" ? "deep" : "smart");
export const parseChoice = (raw: unknown): LevelChoice => (typeof raw === "string" && (CHOICES as readonly string[]).includes(raw) ? raw as LevelChoice : "auto");

/** Why a level was picked: a short key, shown (translated) in the word's tooltip. */
export type Why = "simple" | "default" | "code" | "planning" | "asked" | "files" | "chosen" | "safety" | "usage" | "call";

// Code work: a code block, a stack trace, or asking to write/fix/refactor code.
const CODE = /```|\bTraceback\b|\b(?:Error|Exception):\s|\b(write|implement|build|fix|debug|refactor|optimi[sz]e|review|port|convert)\b[^.?!\n]{0,40}\b(code|function|script|class|component|module|bug|error|test|query|regex|endpoint|api|luau|typescript|javascript|python|sql|shader)\b/i;
// Multi-step / planning work.
const PLAN = /\b(step[- ]by[- ]step|roadmap|plan (out|for|my|the|a)|make a plan|strateg(y|ies)|architect(ure)?|trade-?offs?|pros and cons|compare\b[^.?!\n]{0,60}\b(and|vs\.?|versus|or)\b|break (it|this) down|multi[- ]step|end[- ]to[- ]end)\b/i;
const ASKED = /^\W*deep\s*:|\bthink (hard|deeply|carefully|it through)\b|\bdeep[- ]dive\b/i;

/** The level from the request alone (no override, no quota). */
export function autoLevel(question: string, prevAssistant = "", attach = false): { level: Level; why: Why } {
  const q = question.trim();
  if (ASKED.test(q)) return { level: "deep", why: "asked" };
  const base = pickModel(q, prevAssistant);
  if (base === "deep") return { level: "deep", why: "planning" };
  if (CODE.test(q)) return { level: "deep", why: "code" };
  // A planning ask needs a few words of substance: "plan?" alone is chit-chat.
  if (PLAN.test(q) && q.split(/\s+/).length >= 6) return { level: "deep", why: "planning" };
  if (attach) return { level: "normal", why: "files" };
  return base === "fast" ? { level: "quick", why: "simple" } : { level: "normal", why: "default" };
}

export type Quota = { pct: number; warnPct: number; limited: boolean };
export type Pick = { level: Level; why: Why; choice: LevelChoice; capped?: boolean };

/** Deep is allowed when no real limit is on and the window has room: auto needs to be under the warning line, a chosen deep under 100 %. */
export const deepAllowed = (q: Quota | null | undefined, chosen: boolean) => !q || (!q.limited && q.pct < (chosen ? 100 : q.warnPct));

/** The level a turn runs at. risky: the turn's safety hint (always deep). call: a phone call (no deep: the reply must start fast). */
export function pickLevel(o: { question: string; prev?: string; choice?: LevelChoice; quota?: Quota | null; risky?: boolean; call?: boolean; attach?: boolean }): Pick {
  const choice = o.choice ?? "auto";
  if (o.risky && !o.call) return { level: "deep", why: "safety", choice };
  let p: Pick = choice === "auto" ? { ...autoLevel(o.question, o.prev, o.attach), choice } : { level: choice, why: "chosen", choice };
  if (p.level === "quick" && o.attach) p = { level: "normal", why: "files", choice }; // the fast model doesn't read files
  if (p.level === "deep" && o.call) return { level: "normal", why: "call", choice };
  if (p.level === "deep" && !deepAllowed(o.quota, choice === "deep")) return { level: "normal", why: "usage", choice, capped: true };
  return p;
}

/** The trace line that carries the level (persisted with the answer, so a reopened chat still shows its word). */
export const levelDetail = (p: Pick) => `${p.level} · ${p.choice === "auto" ? "auto" : "chosen"} · ${p.why}${p.capped ? " · capped" : ""}`;
/** Back from a trace line: the level and why, or null. */
export function parseLevelDetail(detail: string | undefined): { level: Level; why: Why; capped: boolean } | null {
  const m = /^(quick|normal|deep) · (auto|chosen) · ([a-z]+)( · capped)?$/.exec(detail ?? "");
  return m ? { level: m[1] as Level, why: m[3] as Why, capped: !!m[4] } : null;
}

/** The level an answer actually ran at: the trace line, adjusted by what happened (a quick turn that reached for a tool was redone
 *  normal, a deep one that ran out of time finished normal). model: the tier the turn ended on, when the client got it live. */
export function answerLevel(trace: readonly { step: string; detail?: string }[] | undefined, model?: string): { level: Level; why: Why; capped: boolean } | null {
  const line = (trace ?? []).find((s) => s.step === "level");
  const p = parseLevelDetail(line?.detail);
  const ran = levelOfTier(model);
  if (!p) return ran ? { level: ran, why: "default", capped: false } : null;
  return ran && ran !== p.level ? { ...p, level: ran } : p;
}
