// Weekly memory hygiene (pure, tested in tests/memory-hygiene.test.ts). IO: memory-hygiene.ts; API: /api/memories/hygiene;
// UI: MemoryHygiene.tsx in the MEMORY panel. It only PROPOSES (at most 3 a week); the owner's Accept runs the existing
// memory/fact routes. No model call anywhere, and proposals hold ids only (no memory text), so journals never leave MEMORY.
import { cosine } from "./sleep-pure.ts";
import type { Fact } from "./facts-pure.ts";

export const MAX_PER_WEEK = 3;
export const DUP_MIN = 0.93; // stricter than the overnight consolidation (0.9): this one ends in a delete
export const DUP_GEN_MIN = 0.97; // generated (dated) outputs share a template, so cosine alone overstates sameness
export const STALE_DAYS = 365;
const DAY = 86_400_000;

export type HMem = { id: string; title: string; content: string; kind: string; tags: string[]; created_at: string; embedding: number[] | null };
export type HProposal = {
  key: string; action: "merge" | "retract"; ids: string[]; // merge: [keep, drop]; retract: [factId]
  why: "same text" | "near duplicate" | "re-run" | "version" | "contradicted" | "superseded" | "stale"; score: number;
  status: "pending" | "accepted" | "dismissed";
};

/** Lowercase letters and digits only, single spaces: "Buy milk!" and "buy  milk" match. */
export const normText = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const subjectKey = (s: string) => normText(s).replace(/^(?:my|the|a|an) /, "").split(" ").map((w) => w.replace(/(?<=\w{3})s$/, "")).join(" ");
const NEG = /\b(?:not|no longer|don ?t|do not|never|stopped|quit|hate|dislike|can ?t stand)\b/;
const polarity = (s: string) => !NEG.test(normText(s));

const MON = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|jaan|veebr|märts|mai|juuni|juuli|sept|okt|dets";
const DATE = new RegExp(`\\b(?:(?:mon|tue|wed|thu|fri|sat|sun)\\p{L}* |[etknrlp] )?(?:\\d{4} \\d{1,2} \\d{1,2}|\\d{1,2} (?:${MON})\\p{L}*(?: \\d{4})?|(?:${MON})\\p{L}* \\d{1,2}(?: \\d{4})?)\\b`, "u");
/** A title's date ("24 oct", "2026 10 24"), its explicit version (v2 → 2, none → 1) and the rest, normalized. */
export function titleParts(title: string) {
  const n = normText(title), date = n.match(DATE)?.[0] ?? "", v = n.match(/\bv ?(\d+)\b/);
  const base = n.replace(DATE, " ").replace(/\bv ?\d+\b/, " ").replace(/\s+/g, " ").trim();
  return { date: date.replace(/^\p{L}+ (?=\d)/u, "").replace(/ \d{4}$/, ""), version: v ? Number(v[1]) : 1, base };
}
/** What a pair of look-alike memories really is. Differently dated outputs (briefs, digests, reports) are separate days: skip.
 *  Same base title and date = a re-run of a generated output; an explicit v2 = an intended version. Both: keep newest, archive older. */
export function mergeSense(a: { title: string }, b: { title: string }): "merge" | "skip" | "rerun" | "version" {
  const x = titleParts(a.title), y = titleParts(b.title);
  if ((x.date || y.date) && x.date !== y.date) return "skip";
  if (x.base && x.base === y.base) return x.version !== y.version ? "version" : x.date ? "rerun" : "merge";
  return "merge";
}

/** Keep the one with more to say (older on a tie: it has the links); fold in the other's text unless it's already contained. */
export function mergePlan(a: Pick<HMem, "id" | "content" | "created_at">, b: Pick<HMem, "id" | "content" | "created_at">) {
  const [keep, drop] = b.content.length > a.content.length || (b.content.length === a.content.length && b.created_at < a.created_at) ? [b, a] : [a, b];
  return { keep: keep.id, drop: drop.id, content: mergedContent(keep.content, drop.content) };
}
/** The kept memory's new content, or null when it already says everything the dropped one did. */
export const mergedContent = (keep: string, drop: string) =>
  normText(keep).includes(normText(drop)) ? null : `${keep.trimEnd()}\n\n${drop.trim()}`;

/** Near-duplicate pairs: same normalized text, or embedding cosine ≥ min. Only within one kind (a journal never merges into a note),
 *  never a consolidated note with its own member (the overnight loop keeps those on purpose). */
export function dupCandidates(mems: HMem[], min = DUP_MIN): HProposal[] {
  const out: HProposal[] = [];
  const norm = mems.map((m) => normText(`${m.title} ${m.content}`));
  for (let i = 0; i < mems.length; i++) for (let j = i + 1; j < mems.length; j++) {
    const a = mems[i], b = mems[j];
    if (a.kind !== b.kind || a.tags.includes(b.id) || b.tags.includes(a.id) || a.tags.includes(`v:${b.id}`) || b.tags.includes(`v:${a.id}`)) continue; // v: = kept on purpose as a separate version
    const sense = mergeSense(a, b), key = `merge:${[a.id, b.id].sort().join(":")}`;
    if (sense === "skip") continue;
    if (sense !== "merge") { // archive, never a text merge
      const [keep, drop] = a.created_at >= b.created_at ? [a, b] : [b, a];
      out.push({ key, action: "merge", ids: [keep.id, drop.id], why: sense === "rerun" ? "re-run" : "version", score: 2.5, status: "pending" });
      continue;
    }
    const same = !!norm[i] && norm[i] === norm[j];
    const sim = a.embedding && b.embedding ? cosine(a.embedding, b.embedding) : 0;
    if (!same && sim < (titleParts(a.title).date ? Math.max(min, DUP_GEN_MIN) : min)) continue;
    const p = mergePlan(a, b);
    out.push({ key, action: "merge", ids: [p.keep, p.drop], why: same ? "same text" : "near duplicate", score: same ? 3 : 2 + sim, status: "pending" });
  }
  return out;
}

/** Current beliefs worth retracting: an older one on the same subject (contradicted when the polarity flips), or one not restated in a year. */
export function factCandidates(facts: Pick<Fact, "id" | "subject" | "statement" | "status" | "confidence" | "created_at">[], now: number): HProposal[] {
  const cur = facts.filter((f) => f.status === "current").sort((a, b) => b.created_at.localeCompare(a.created_at)); // newest first
  const out: HProposal[] = [], newest = new Map<string, (typeof cur)[number]>();
  for (const f of cur) {
    const k = subjectKey(f.subject), n = newest.get(k);
    if (n) {
      const contra = polarity(n.statement) !== polarity(f.statement);
      out.push({ key: `retract:${f.id}`, action: "retract", ids: [f.id], why: contra ? "contradicted" : "superseded", score: contra ? 4 : 2.5, status: "pending" });
      continue;
    }
    newest.set(k, f);
    const age = (now - Date.parse(f.created_at)) / DAY;
    if (age >= STALE_DAYS) out.push({ key: `retract:${f.id}`, action: "retract", ids: [f.id], why: "stale", score: 1 + Math.min(age / 3650, 0.5) + (1 - f.confidence) * 0.4, status: "pending" });
  }
  return out;
}

/** This week's proposals: best first, never a dismissed key again, never two actions touching the same item. */
export function pickWeekly(cands: HProposal[], dismissed: Iterable<string>, max = MAX_PER_WEEK): HProposal[] {
  const skip = new Set(dismissed), used = new Set<string>(), out: HProposal[] = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))) {
    if (out.length >= max) break;
    if (skip.has(c.key) || c.ids.some((id) => used.has(id))) continue;
    c.ids.forEach((id) => used.add(id));
    out.push(c);
  }
  return out;
}

export type HygieneUser = { week: string; proposals: HProposal[]; dismissed: string[] };
/** The owner's click on a pending proposal. Returns the updated state, or why not. */
export function decide(u: HygieneUser, key: string, decision: "accepted" | "dismissed"): HygieneUser | string {
  const p = u.proposals.find((x) => x.key === key);
  if (!p) return "That suggestion is gone";
  if (p.status !== "pending") return "That suggestion was already handled";
  return {
    ...u, proposals: u.proposals.map((x) => (x === p ? { ...x, status: decision } : x)),
    dismissed: decision === "dismissed" ? [...u.dismissed.filter((k) => k !== key), key].slice(-500) : u.dismissed,
  };
}
