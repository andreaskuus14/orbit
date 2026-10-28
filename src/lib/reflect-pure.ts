// Dependency-free logic for CORE's self-learning (memory drafts, secret filter, reflection parsing, caps).
import { et, } from "./et-ask-pure.ts";
const REMEMBER_ET = et("jäta meelde|jäta see meelde|pea meeles|salvesta|märgi üles|kirjuta üles|ära unusta");
// Unit-tested in tests/reflect.test.ts. Keep this file free of imports and non-erasable TS syntax.

/** Kinds CORE may save by itself (a subset of KINDS in kinds.ts). */
export const CORE_KINDS = ["note", "idea", "project", "preference", "decision", "goal"] as const;
export type CoreKind = (typeof CORE_KINDS)[number];
export type MemoryDraft = { title: string; content: string; kind: CoreKind; tags: string[] };
export type EditDraft = { op: "add" | "remove" | "replace"; rule: string; old?: string };

export const PER_TURN = 3;
export const PER_DAY = 20;
export const SUMMARY_EVERY = 6;

/** Lowercase, drop punctuation/emoji, collapse spaces: "Prefers: Dark-Mode!" → "prefers dark mode". */
export function normTitle(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS = [
  /\b(password|passwd|passcode|pwd|pw|pin|passphrase|secret|api[ _-]?key|access[ _-]?token|auth[ _-]?token|private[ _-]?key|seed phrase|recovery (code|phrase))\b\s*(is|=|:)\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|rk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}/, // OpenAI/Anthropic/Stripe style
  /\b(ghp|gho|ghs|github_pat|xox[abprs]|glpat)[-_][A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /\b(pin|pw|pwd)\b[\s:=#-]*\d{4,8}\b/i, // "pin 1234"
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b[a-f0-9]{32,}\b/i, // hex token / hash
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/, // IBAN
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
  /\b[1-6]\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{4}\b/, // Estonian/Baltic personal ID code
];

/** 32+ char base64-ish run mixing upper, lower and digits (a key, not a word). */
function hasOpaqueToken(text: string): boolean {
  return (text.match(/[A-Za-z0-9+/_-]{32,}/g) ?? []).some((t) => /\d/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t));
}

/** True when text looks like it holds a password, API key, token or payment-card number. */
export function looksSecret(text: string): boolean {
  if (SECRET_PATTERNS.some((p) => p.test(text)) || hasOpaqueToken(text)) return true;
  for (const m of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) {
    const d = m.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return true;
  }
  return false;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validate one memory draft (from the save_memory tool or a reflection). */
export function validateMemory(o: unknown): { draft: MemoryDraft } | { error: string } {
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "expected an object" };
  const r = o as Record<string, unknown>;
  const title = clip(r.title, 200).replace(/\s+/g, " ");
  const content = clip(r.content, 4000);
  if (title.length < 3) return { error: "title is required" };
  if (content.length < 3) return { error: "content is required" };
  if (looksSecret(`${title}\n${content}`)) return { error: "refused: looks like a password, key or card number; secrets are never saved" };
  const kind = (CORE_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as CoreKind) : "note";
  const raw = Array.isArray(r.tags) ? r.tags : typeof r.tags === "string" ? r.tags.split(",") : [];
  const tags: string[] = [];
  for (const t of raw) {
    const tag = typeof t === "string" ? t.trim().toLowerCase().replace(/^#/, "").slice(0, 40) : "";
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return { draft: { title, content, kind, tags: tags.slice(0, 8) } };
}

// Sensitive traits CORE never auto-saves (the user can still save them by hand in MEMORY).
const SENSITIVE = /\b(diagnos\w*|illness|disease|disorder|depress\w*|anxiety|adhd|autis\w*|cancer|diabet\w*|medication|medicine|therap\w*|pregnan\w*|hiv|mental health|symptom\w*|religio\w*|christian\w*|muslim|islam\w*|jewish|judaism|hindu\w*|buddhis\w*|atheis\w*|church|mosque|synagogue|pray\w*|gay|lesbian|bisexual|transgender|queer|sexual\w*|politic\w*|democrat\w*|republican|liberal|conservative|left-wing|right-wing|vote[sd]? for|salary|income|debt|loan|mortgage|net worth|credit score|bank account|ethnic\w*|racial|race)\b/i;

/** True when text touches health, religion, sexuality, politics, finances or ethnicity. */
export function isSensitive(text: string): boolean {
  return SENSITIVE.test(text);
}

const STOP = new Set("user users that this with from have about they them their there what when where which while would could should will your yours just also into than then very really more most some much many like likes liked wants want prefers prefer does done make made thing things been being were them only over each".split(" "));
const words = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const stem = (w: string) => w.slice(0, 5);

/** Share of a candidate's key words (≥4 chars, not stopwords) that the user actually wrote (matched on a 5-char stem). */
export function provenance(candidate: string, userText: string): number {
  const keys = [...new Set(words(candidate).filter((w) => w.length >= 4 && !STOP.has(w)))];
  if (!keys.length) return 0;
  const said = new Set(words(userText).filter((w) => w.length >= 4).map(stem));
  return keys.filter((w) => said.has(stem(w))).length / keys.length;
}

const REMEMBER_RE = /\b(remember|save|saving|memori[sz]e|note (this|that|it|down)|make a note|write (this|that|it) down|don'?t forget|do not forget|keep in mind)\b/i;
const PREFERENCE_RE = /\b(don'?t|do not|stop|prefer\w*|always|never|shorter|longer|instead|please (be|use|answer|reply|write|keep)|too (long|short|verbose|wordy)|from now on|in (estonian|english|finnish|russian|german|bullets?|a table|short))\b/i;

/** The user explicitly asked to save something. */
export const asksToRemember = (msg: string) => REMEMBER_RE.test(msg) || REMEMBER_ET.test(msg);
/** The user stated a style preference or corrected CORE. */
export const hasPreferenceSignal = (msg: string) => PREFERENCE_RE.test(msg);

/** Worth a reflection call: a substantial message, an explicit signal, or a summary turn. */
export function shouldReflect(msg: string, summaryTurn: boolean): boolean {
  return summaryTurn || msg.trim().length >= 40 || asksToRemember(msg) || hasPreferenceSignal(msg);
}

/** Pull the first JSON object out of a model reply; tolerates code fences and prose around it. */
export function extractObject(text: string): Record<string, unknown> | null {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(t.slice(start, end + 1)) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parse a reflection reply into valid, deduped memory drafts (max `max`, none whose normalized title is in
 * existingTitles, none sensitive, and with userText: mostly in the user's own words), shape-checked playbook
 * edits, and an optional summary.
 */
export function parseReflection(text: string, opts: { existingTitles: string[]; max: number; userText?: string }): { memories: MemoryDraft[]; playbook: EditDraft[]; summary: string | null } {
  const j = extractObject(text) ?? {};
  const seen = new Set(opts.existingTitles.map(normTitle).filter(Boolean));
  const memories: MemoryDraft[] = [];
  for (const m of Array.isArray(j.memories) ? j.memories : []) {
    if (memories.length >= Math.max(0, opts.max)) break;
    const v = validateMemory(m);
    if (!("draft" in v)) continue;
    const body = `${v.draft.title} ${v.draft.content}`;
    // Keep only what the user themself said (not CORE's or a web page's words) and never sensitive traits.
    if (isSensitive(body) || (opts.userText !== undefined && provenance(body, opts.userText) < 0.6)) continue;
    const key = normTitle(v.draft.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    memories.push(v.draft);
  }
  const playbook: EditDraft[] = [];
  for (const e of Array.isArray(j.playbook) ? j.playbook.slice(0, 5) : []) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const op = r.op === "add" || r.op === "remove" || r.op === "replace" ? r.op : null;
    const rule = clip(r.rule, 300);
    if (!op || !rule || looksSecret(rule)) continue;
    const old = clip(r.old, 300);
    playbook.push(old ? { op, rule, old } : { op, rule });
  }
  const s = clip(j.summary, 1500);
  return { memories, playbook, summary: s.length >= 10 && !looksSecret(s) ? s : null };
}

/** How many auto-saves this turn may make, given how many were already made today. */
export function allowedSaves(savedToday: number, perTurn = PER_TURN, perDay = PER_DAY): number {
  return Math.max(0, Math.min(perTurn, perDay - savedToday));
}

/** Write/refresh the conversation summary every SUMMARY_EVERY user turns. */
export function summaryDue(userTurns: number, every = SUMMARY_EVERY): boolean {
  return userTurns > 0 && userTurns % every === 0;
}
