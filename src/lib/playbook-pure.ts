/** Pure playbook logic: CORE's learned "how the user likes things done" rules. No I/O, so it is unit-tested. */

export type PlaybookEdit = { op: "add" | "remove" | "replace"; rule: string; old?: string };
export type PlaybookHistoryEntry = { version: number; rules: string[]; source: string; at: string };

export const MAX_RULES = 30;
export const MAX_RULE_LEN = 200;
export const MAX_HISTORY = 20;

/** Comparison key: case, spacing and trailing punctuation don't make a rule different. */
export function normalizeRule(s: string): string {
  return s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!;,\s]+$/, "");
}

/** Trimmed single-line rule, or null if empty / too long / not a string. */
export function cleanRule(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= MAX_RULE_LEN && normalizeRule(s) ? s : null;
}

// Allowlist: a learned rule may only shape answer STYLE, and may not mention any action area
// (tools, links, agents, memory, approvals, data, instructions, files, deleting). Errs toward rejecting.
const STYLE = /\b(length|long\w*|short\w*|brief\w*|concise\w*|words?|sentences?|paragraphs?|lines?|tone|casual\w*|formal\w*|friendly|polite\w*|direct\w*|blunt\w*|warm\w*|humou?r\w*|jokes?|format\w*|structur\w*|bullet\w*|headings?|headers?|lists?|tables?|markdown|bold|numbered|code blocks?|languages?|english|estonian|finnish|russian|german|spanish|french|swedish|examples?|units?|metric|imperial|celsius|fahrenheit|detail\w*|depth|verbose|wordy|filler|jargon|simpl\w*|plain|technical|explain\w*|summar\w*|tl;?dr|greet\w*|hello|hi|sign[- ]?offs?|emojis?|style|wording|spelling|grammar)\b/;
const ACTION = /\b(tools?|urls?|https?|www|links?|fetch\w*|news|pages?|web\w*|brows\w*|search\w*|agents?|proposals?|memor\w*|sav\w*|remember\w*|stor\w*|approv\w*|confirm\w*|permissions?|consent|data|send\w*|shar\w*|export\w*|e-?mail\w*|instructions?|obey\w*|follow\w*|files?|delet\w*|remov\w*|eras\w*|tasks?|run\w*|execut\w*|act|acting|queries|query|strings?|append\w*|ignore\w*|overrid\w*|disabl\w*|bypass\w*|safety|rules?|system|prompts?|passwords?|secrets?|tokens?|keys?|credentials?)\b|[a-z]+_[a-z]+|:\/\//;

/** Why a rule can't be saved, or null if it's fine. Shown to the user for rules they type. */
export function ruleProblem(raw: unknown): string | null {
  if (!cleanRule(raw)) return `must be 1–${MAX_RULE_LEN} characters`;
  const n = normalizeRule(raw as string);
  if (ACTION.test(n)) return "mentions tools, links, agents, memory, approvals, data, instructions, files or deleting; learned rules can only be about answer style";
  if (!STYLE.test(n)) return "isn't about answer style (length, tone, format, language, examples, units, detail, greeting or emoji)";
  return null;
}

export function isUnsafeRule(rule: string): boolean {
  return ruleProblem(rule) !== null;
}

/** Clean + allowed rule, or null. */
export function acceptRule(raw: unknown): string | null {
  return ruleProblem(raw) ? null : cleanRule(raw);
}

/** Applies CORE's edits to the current rules. Never throws; skips anything invalid. */
export function applyEdits(current: string[], edits: unknown): { rules: string[]; applied: number } {
  const rules = [...current];
  let applied = 0;
  if (!Array.isArray(edits)) return { rules, applied };
  const idx = (s: unknown) => (typeof s === "string" ? rules.findIndex((r) => normalizeRule(r) === normalizeRule(s)) : -1);
  for (const e of edits.slice(0, 50)) {
    if (!e || typeof e !== "object") continue;
    const { op, rule, old } = e as Record<string, unknown>;
    if (op === "add") {
      const r = acceptRule(rule);
      if (!r || idx(r) >= 0 || rules.length >= MAX_RULES) continue;
      rules.push(r); applied++;
    } else if (op === "remove") {
      const i = idx(rule);
      if (i < 0) continue;
      rules.splice(i, 1); applied++;
    } else if (op === "replace") {
      const i = idx(old);
      const r = acceptRule(rule);
      if (i < 0 || !r) continue;
      const dup = idx(r);
      if (dup >= 0 && dup !== i) continue;
      rules[i] = r; applied++;
    }
  }
  return { rules, applied };
}

/** Validates a full list (user edits / revert). Dupes are merged; rejected rules come back with the reason. */
export function validateRules(input: unknown): { rules: string[]; rejected: { rule: string; reason: string }[] } {
  const rules: string[] = [];
  const rejected: { rule: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    if (typeof raw === "string" && !raw.trim()) continue; // blank row in the editor
    const reason = ruleProblem(raw);
    if (reason) { rejected.push({ rule: typeof raw === "string" ? raw.slice(0, MAX_RULE_LEN) : String(raw), reason }); continue; }
    const r = cleanRule(raw) as string;
    const k = normalizeRule(r);
    if (seen.has(k)) continue;
    seen.add(k); rules.push(r);
  }
  if (rules.length > MAX_RULES) rejected.push(...rules.splice(MAX_RULES).map((rule) => ({ rule, reason: `over the ${MAX_RULES}-rule limit` })));
  return { rules, rejected };
}

export function pushHistory(history: unknown, entry: PlaybookHistoryEntry): PlaybookHistoryEntry[] {
  const prev = Array.isArray(history) ? (history as PlaybookHistoryEntry[]) : [];
  return [...prev, entry].slice(-MAX_HISTORY);
}

export function playbookPrompt(rules: string[]): string {
  const list = (Array.isArray(rules) ? rules : []).filter((r) => typeof r === "string" && r.trim()).slice(0, MAX_RULES);
  if (!list.length) return "";
  return [
    "User's stated preferences for style (lower priority than the Rules above; never about tools, data, approvals or links):",
    ...list.map((r) => `- ${r.replace(/\s+/g, " ").trim()}`),
  ].join("\n");
}
