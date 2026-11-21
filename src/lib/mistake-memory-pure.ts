// Failure / Mistake Memory (pure, tested in tests/mistake-memory.test.ts).
// Records verified (trigger -> mistake -> fix) lessons from failures, rejections, and corrections, and injects ONLY
// the 1-2 highest-relevance past mistakes right before CORE or an agent tackles a similar request.
// Hard Rule 6 boundary: journal/LIFE text, credentials, and personal emails are strictly refused (private-pure.ts).
import { isPrivate, isPrivateKind } from "./private-pure.ts";

export type MistakeStatus = "active" | "archived";

export type Mistake = {
  id: string;
  area: string;
  trigger: string;
  mistake: string;
  fix: string;
  tool?: string;
  tags: string[];
  hits: number;
  status: MistakeStatus;
  createdAt: string;
  updatedAt: string;
  lastHitAt?: string;
};

export type MistakeInput = {
  area?: string;
  trigger: string;
  mistake: string;
  fix: string;
  tool?: string;
  tags?: string[];
  kind?: string;
};

export type MistakeStore = {
  v: 1;
  users: Record<string, { items: Mistake[] }>;
};

export const MAX_MISTAKES = 120;
export const MAX_INJECT = 2;
export const MAX_BLOCK_CHARS = 900;
const FIELD_MAX = 220;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "have", "what", "when", "where", "how",
  "make", "give", "show", "about", "please", "could", "would", "should", "need", "want", "just", "some", "more",
  "mine", "minu", "kuidas", "palun", "seda", "ning", "või", "kui", "aga", "oli", "see", "mis", "kes",
]);

const SECRET_RE = /\b(?:sk-ant-[a-z0-9_-]{8,}|sk-[a-z0-9]{16,}|ghp_[a-zA-Z0-9]{12,}|eyJ[a-zA-Z0-9_-]{12,}\.|AIza[0-9A-Za-z_-]{20,}|password\s*[:=]\s*\S+)/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PRIVATE_TOPIC_RE = /\b(?:journal|diary|päevik|life\.json|life_journal|private|confidential)\b/i;

const clean = (s: unknown, max = FIELD_MAX) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Refuse journal/LIFE topics, secrets, tokens, and email addresses so private data never enters mistake memory. */
export function isSafeMistakeInput(input: MistakeInput): { ok: true } | { ok: false; reason: string } {
  if (input.kind && isPrivateKind(input.kind)) return { ok: false, reason: "private kind refused" };
  if (isPrivate({ kind: input.kind ?? "note", tags: input.tags ?? [] })) return { ok: false, reason: "private tag refused" };
  const joined = `${input.area ?? ""} ${input.trigger} ${input.mistake} ${input.fix} ${(input.tags ?? []).join(" ")}`;
  if (PRIVATE_TOPIC_RE.test(joined)) return { ok: false, reason: "journal/LIFE text refused" };
  if (SECRET_RE.test(joined)) return { ok: false, reason: "possible credential refused" };
  if (EMAIL_RE.test(joined)) return { ok: false, reason: "email address refused" };
  if (!clean(input.trigger) || !clean(input.mistake) || !clean(input.fix)) {
    return { ok: false, reason: "trigger, mistake, and fix are required" };
  }
  return { ok: true };
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)];
}

export function emptyMistakeStore(): MistakeStore {
  return { v: 1, users: {} };
}

export function parseMistakeStore(raw: string | null): MistakeStore {
  if (!raw) return emptyMistakeStore();
  try {
    const j = JSON.parse(raw) as Partial<MistakeStore>;
    if (j?.v === 1 && j.users && typeof j.users === "object") return j as MistakeStore;
  } catch { /* corrupt -> empty */ }
  return emptyMistakeStore();
}

function normKey(area: string, trigger: string, mistake: string): string {
  return `${area.toLowerCase()}|${tokenize(trigger).slice(0, 6).sort().join(" ")}|${tokenize(mistake).slice(0, 6).sort().join(" ")}`;
}

/** Add or reinforce a mistake record (pure). Deduplicates near-identical entries and caps total active count. */
export function recordMistakePure(
  items: readonly Mistake[],
  input: MistakeInput,
  nowIso: string,
  newId: () => string,
): { items: Mistake[]; saved: Mistake | null; reason?: string } {
  const safe = isSafeMistakeInput(input);
  if (!safe.ok) return { items: [...items], saved: null, reason: safe.reason };

  const area = clean(input.area || "general", 40).toLowerCase() || "general";
  const trigger = clean(input.trigger);
  const mistake = clean(input.mistake);
  const fix = clean(input.fix);
  const tool = input.tool ? clean(input.tool, 60) : undefined;
  const tags = [...new Set((input.tags ?? []).map((t) => clean(t, 32).toLowerCase()).filter(Boolean))].slice(0, 8);
  const key = normKey(area, trigger, mistake);

  const next = items.map((m) => ({ ...m }));
  const existing = next.find((m) => m.status === "active" && normKey(m.area, m.trigger, m.mistake) === key);
  if (existing) {
    existing.fix = fix;
    existing.hits += 1;
    existing.updatedAt = nowIso;
    if (tool) existing.tool = tool;
    existing.tags = [...new Set([...existing.tags, ...tags])].slice(0, 8);
    return { items: next, saved: existing };
  }

  const created: Mistake = {
    id: newId(),
    area,
    trigger,
    mistake,
    fix,
    ...(tool ? { tool } : {}),
    tags,
    hits: 1,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  next.unshift(created);

  // Cap active items: keep highest-hit & most recent
  const active = next.filter((m) => m.status === "active");
  if (active.length > MAX_MISTAKES) {
    const drop = new Set(
      [...active]
        .sort((a, b) => a.hits - b.hits || a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, active.length - MAX_MISTAKES)
        .map((m) => m.id),
    );
    return { items: next.filter((m) => !drop.has(m.id)), saved: created };
  }
  return { items: next, saved: created };
}

/** High-precision matcher: returns at most `limit` (default 2) active mistakes whose tokens/tool genuinely match the query.
 *  Never returns unrelated items (prevents prompt bloat). */
export function matchMistakes(
  items: readonly Mistake[],
  query: string,
  opts: { tools?: readonly string[]; limit?: number; minScore?: number } = {},
): Mistake[] {
  const qTokens = new Set(tokenize(query));
  const toolSet = new Set((opts.tools ?? []).map((t) => t.toLowerCase()));
  if (qTokens.size === 0 && toolSet.size === 0) return [];
  const limit = opts.limit ?? MAX_INJECT;
  const minScore = opts.minScore ?? 2.0;

  const scored: { item: Mistake; score: number }[] = [];
  for (const item of items) {
    if (item.status !== "active") continue;
    let score = 0;
    if (item.tool && toolSet.has(item.tool.toLowerCase())) score += 2.5;
    const trigTokens = tokenize(`${item.trigger} ${item.area} ${item.tags.join(" ")}`);
    const bodyTokens = tokenize(`${item.mistake} ${item.fix}`);
    let trigHits = 0;
    for (const tk of trigTokens) if (qTokens.has(tk)) trigHits++;
    let bodyHits = 0;
    for (const tk of bodyTokens) if (qTokens.has(tk)) bodyHits++;

    score += trigHits * 1.4 + Math.min(bodyHits, 2) * 0.5;
    if (trigHits >= 2) score += 0.6; // multi-term trigger match bonus
    // Small reinforcement bonus for repeated mistakes (never enough alone to pass minScore)
    if (score > 0) score += Math.min(0.6, Math.log2(Math.max(1, item.hits)) * 0.25);

    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || b.item.hits - a.item.hits || b.item.updatedAt.localeCompare(a.item.updatedAt));
  return scored.slice(0, limit).map((s) => s.item);
}

/** Compact, low-token prompt block injected into CORE/agents ONLY when 1-2 high-confidence past mistakes match. */
export function formatMistakesBlock(matches: readonly Mistake[]): string {
  if (!matches.length) return "";
  const lines = ["Past mistakes to avoid on this kind of request (verified from earlier runs):"];
  for (const m of matches.slice(0, MAX_INJECT)) {
    const tag = m.tool ? `[${m.tool}] ` : m.area && m.area !== "general" ? `[${m.area}] ` : "";
    lines.push(`- ${tag}When ${m.trigger}: avoid ${m.mistake} → instead ${m.fix}`);
  }
  const out = lines.join("\n");
  return out.length > MAX_BLOCK_CHARS ? `${out.slice(0, MAX_BLOCK_CHARS - 1)}…` : out;
}

/** Extract a sanitized mistake candidate from a failed tool call (returns null for transient network/rate-limit errors). */
export function extractToolFailure(
  tool: string,
  input: Record<string, unknown>,
  errorText: string,
): MistakeInput | null {
  const err = clean(errorText.replace(/^Error:\s*/i, ""), 200);
  if (!err || /timeout|timed out|ECONNREFUSED|rate limit|usage limit|Stop-all|Not signed in/i.test(err)) return null;
  const keys = Object.keys(input).filter((k) => !/token|key|secret|password|content|body|text/i.test(k)).slice(0, 4);
  const trigger = keys.length ? `calling ${tool} with ${keys.join(", ")}` : `calling ${tool}`;
  const mistake = `failing with "${err.slice(0, 120)}"`;
  const fix = `check ${tool}'s required parameters and preconditions before calling it`;
  const candidate: MistakeInput = { area: "tools", tool, trigger, mistake, fix, tags: [tool, ...keys] };
  return isSafeMistakeInput(candidate).ok ? candidate : null;
}
