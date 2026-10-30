// MEM05 one review queue, pure: hygiene merges, uncertain (inferred) memories and beliefs, contradicted/superseded beliefs and
// stale project knowledge in one ranked list. Each record appears at most once; decided, discarded or snoozed items leave the
// queue everywhere. No model call: items hold ids and the owner's own labels. Tested in tests/memory-review.test.ts.
import type { HProposal, HygieneUser } from "./memory-hygiene-pure.ts";
import { projectOf } from "./memory-workspace-pure.ts";

export const QUEUE_TOP = 5;
export const SNOOZE_DAYS = 7;
export const STALE_PROJECT_DAYS = 180;
const DAY = 86_400_000;

export type RKind = "merge" | "contradicted" | "superseded" | "stale-belief" | "inferred" | "inferred-belief" | "stale-project";
export type RItem = {
  key: string; kind: RKind; target: "memory" | "fact"; ids: string[]; score: number;
  items: { id: string; title: string; text: string; subject?: string }[];
};
export type Decision = "accepted" | "corrected" | "snoozed" | "dismissed";
export type ReviewState = HygieneUser & { snoozed?: Record<string, number>; done?: string[] };

type QMem = { id: string; title: string; content: string; kind: string; tags: string[] | null; folder?: string | null; source?: string | null; confirmation?: string | null; updated_at?: string; created_at: string };
type QFact = { id: string; subject: string; statement: string; status: string; source: string; confirmation?: string | null; created_at: string };

const WHY_KIND: Record<HProposal["why"], RKind> = { "same text": "merge", "near duplicate": "merge", contradicted: "contradicted", superseded: "superseded", stale: "stale-belief" };
const skip = (m: QMem) => m.kind === "journal" || m.kind === "conversation" || (m.tags ?? []).some((t) => t === "superseded" || t === "revoked");

/** Everything waiting for the owner, best first, at most `top`. One record never shows up in two items. */
export function buildQueue(src: { proposals: (HProposal & { items: { id: string; title: string }[] })[]; mems: QMem[]; facts: QFact[] },
  st: Pick<ReviewState, "dismissed" | "snoozed" | "done">, now: number, top = QUEUE_TOP): RItem[] {
  const mem = new Map(src.mems.map((m) => [m.id, m])), fact = new Map(src.facts.map((f) => [f.id, f]));
  const label = (id: string, fallback: string) => {
    const m = mem.get(id), f = fact.get(id);
    return f ? { id, title: f.subject, text: f.statement, subject: f.subject } : { id, title: m?.title ?? fallback, text: m?.content.slice(0, 2000) ?? "" };
  };
  const out: RItem[] = src.proposals.filter((p) => p.status === "pending").map((p) => ({
    key: p.key, kind: WHY_KIND[p.why], target: p.action === "merge" ? "memory" : "fact", ids: p.ids, score: p.score,
    items: p.items.map((it) => label(it.id, it.title)),
  }));
  for (const m of src.mems) {
    if (skip(m)) continue;
    if (m.confirmation === "suggested" || m.source === "inferred") out.push({ key: `infer:${m.id}`, kind: "inferred", target: "memory", ids: [m.id], score: 2.2, items: [label(m.id, m.title)] });
    else if (projectOf({ ...m, tags: m.tags ?? [] }) && now - Date.parse(m.updated_at ?? m.created_at) >= STALE_PROJECT_DAYS * DAY)
      out.push({ key: `stale:${m.id}`, kind: "stale-project", target: "memory", ids: [m.id], score: 1 + Math.min((now - Date.parse(m.updated_at ?? m.created_at)) / (3650 * DAY), 0.5), items: [label(m.id, m.title)] });
  }
  for (const f of src.facts) if (f.status === "current" && (f.source === "inferred" || f.confirmation === "suggested"))
    out.push({ key: `belief:${f.id}`, kind: "inferred-belief", target: "fact", ids: [f.id], score: 2.3, items: [label(f.id, f.subject)] });

  const gone = new Set([...st.dismissed, ...(st.done ?? [])]), snoozed = st.snoozed ?? {}, used = new Set<string>(), picked: RItem[] = [];
  for (const it of out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))) {
    if (picked.length >= top) break;
    if (gone.has(it.key) || (snoozed[it.key] ?? 0) > now || it.ids.some((id) => used.has(id))) continue;
    it.ids.forEach((id) => used.add(id));
    picked.push(it);
  }
  return picked;
}

/** Record the owner's decision. Hygiene proposals keep their status; every other item is remembered as done or snoozed. */
export function decideReview(u: ReviewState, key: string, d: Decision, now: number): ReviewState {
  const snoozed = { ...(u.snoozed ?? {}) };
  delete snoozed[key];
  if (d === "snoozed") return { ...u, snoozed: { ...snoozed, [key]: now + SNOOZE_DAYS * DAY } };
  const status = d === "dismissed" ? "dismissed" : "accepted";
  return {
    ...u, snoozed,
    proposals: u.proposals.map((p) => (p.key === key ? { ...p, status } : p)),
    dismissed: d === "dismissed" ? [...u.dismissed.filter((k) => k !== key), key].slice(-500) : u.dismissed,
    done: d === "dismissed" ? u.done : [...(u.done ?? []).filter((k) => k !== key), key].slice(-1000),
  };
}
