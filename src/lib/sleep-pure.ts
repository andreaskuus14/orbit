// Sleep loop (pure, tested in tests/sleep.test.ts): CORE's nightly consolidation. I/O and the model calls live in sleep.ts.
import { extractObject, isSensitive, provenance, validateMemory, type MemoryDraft } from "./reflect-pure.ts";
import { normalizeRule, type RuleCounters } from "./playbook-pure.ts";
import { localDay } from "./morning-pure.ts";

export const SLEEP_FROM_HOUR = 3, SLEEP_UNTIL_HOUR = 7; // a PC woken by the night run (04:30) still lands in the window
export const MAX_CALLS = 3; // hard cap of model calls per night
export const DUP_SIMILARITY = 0.9;
export const MAX_GROUPS = 3, GROUP_MAX = 4;

export type UserSleep = { counters: RuleCounters; report?: { day: string; line: string; at: string } };
export type SleepState = { lastNight?: string; users: Record<string, UserSleep> };

export function parseSleep(text: string): SleepState {
  try {
    const j = JSON.parse(text) as SleepState;
    return j && typeof j === "object" && j.users && typeof j.users === "object" ? j : { users: {} };
  } catch { return { users: {} }; }
}

/** Once per local night, between 03:00 and 07:00. */
export const sleepDue = (now: Date, lastNight: string | undefined) =>
  now.getHours() >= SLEEP_FROM_HOUR && now.getHours() < SLEEP_UNTIL_HOUR && lastNight !== localDay(now);

export function cosine(a: number[], b: number[]): number {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

export type Mem = { id: string; title: string; content: string; embedding: number[] | null };

/** pgvector comes back as "[0.1,0.2,…]"; anything else is null. */
export function parseVec(v: unknown): number[] | null {
  try {
    const a = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(a) && a.length && a.every((n) => typeof n === "number") ? a : null;
  } catch { return null; }
}

/** Greedy near-duplicate clusters (≥ DUP_SIMILARITY to the seed), skipping memories already consolidated. */
export function dupGroups(mems: Mem[], done: Set<string>, min = DUP_SIMILARITY): Mem[][] {
  const free = mems.filter((m) => m.embedding && !done.has(m.id));
  const used = new Set<string>(), groups: Mem[][] = [];
  for (const seed of free) {
    if (used.has(seed.id)) continue;
    const g = [seed, ...free.filter((m) => m !== seed && !used.has(m.id) && cosine(seed.embedding!, m.embedding!) >= min)].slice(0, GROUP_MAX);
    if (g.length < 2) continue;
    g.forEach((m) => used.add(m.id));
    groups.push(g);
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups;
}

/** The model's merged notes, as data: shape-checked, no secrets or sensitive traits, and grounded in the group's own text. */
export function parseConsolidation(text: string, groups: Mem[][]): { group: number; draft: MemoryDraft }[] {
  const notes = extractObject(text)?.notes;
  const out: { group: number; draft: MemoryDraft }[] = [];
  for (const n of Array.isArray(notes) ? notes : []) {
    const g = Number((n as Record<string, unknown>)?.group);
    if (!Number.isInteger(g) || !groups[g] || out.some((o) => o.group === g)) continue;
    const v = validateMemory(n);
    if ("error" in v) continue;
    const src = groups[g].map((m) => `${m.title}\n${m.content}`).join("\n");
    if (isSensitive(`${v.draft.title}\n${v.draft.content}`) && !isSensitive(src)) continue;
    if (provenance(v.draft.content, src) < 0.6) continue;
    out.push({ group: g, draft: { ...v.draft, kind: "note", tags: ["consolidated", ...groups[g].map((m) => m.id)] } });
  }
  return out;
}

/** A correction or praise right after a CORE answer: the only evidence a rule helped or hurt (no thumbs in ORBIT yet). */
const PRAISE = /\b(thanks|thank you|perfect|great|exactly|nice|love it|much better)\b/i;
export type Turn = { conversation_id: string; role: string; content: string; created_at: string };
export function evidencePairs(msgs: Turn[], isCorrection: (s: string) => boolean, max = 20): { reply: string; followUp: string }[] {
  const sorted = [...msgs].sort((a, b) => a.conversation_id.localeCompare(b.conversation_id) || a.created_at.localeCompare(b.created_at));
  const out: { reply: string; followUp: string }[] = [];
  for (let i = 1; i < sorted.length && out.length < max; i++) {
    const p = sorted[i - 1], m = sorted[i];
    if (p.conversation_id !== m.conversation_id || p.role !== "assistant" || m.role !== "user") continue;
    if (isCorrection(m.content) || PRAISE.test(m.content)) out.push({ reply: p.content.slice(0, 400), followUp: m.content.slice(0, 300) });
  }
  return out;
}

/** Verdicts the model gave, only for rules that exist, one per rule per pair index. */
export function parseEvidence(text: string, rules: string[]): { rule: string; verdict: "helpful" | "harmful" }[] {
  const ev = extractObject(text)?.evidence;
  const seen = new Set<string>(), out: { rule: string; verdict: "helpful" | "harmful" }[] = [];
  for (const e of Array.isArray(ev) ? ev.slice(0, 100) : []) {
    const r = e as Record<string, unknown>;
    const rule = rules[Number(r?.rule)], verdict = r?.verdict;
    if (!rule || (verdict !== "helpful" && verdict !== "harmful")) continue;
    const k = `${normalizeRule(rule)}|${r.pair}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ rule, verdict });
  }
  return out;
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
/** The morning card's "Overnight: …" text; "" when nothing happened. shorts: 48 h verdicts captured since last night. */
export function reportLine(r: { consolidated: number; retired: number; merged: number; shorts?: { worked: number; flopped: number } }): string {
  const bits = [
    r.consolidated && `merged ${n(r.consolidated, "group")} of similar memories`,
    r.retired && `${n(r.retired, "style rule")} looked unhelpful (worth a look in your playbook)`,
    r.merged && `removed ${n(r.merged, "duplicate rule")}`,
    r.shorts && r.shorts.worked + r.shorts.flopped && `Shorts at 48 h: ${r.shorts.worked} above your median, ${r.shorts.flopped} below`,
  ].filter(Boolean) as string[];
  return bits.join("; ");
}
