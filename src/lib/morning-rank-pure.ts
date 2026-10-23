// Morning cards (pure, tested in tests/morning-rank.test.ts): the briefing's 5 highest-value items, one per kind when it can,
// ranked by a base value and what 👍/👎 taught (ledger "morning.thumb" events). Gathering: morning.ts. No LIFE data goes in here.
import type { WorkItem } from "./work-continuation-pure";

export const CARD_KINDS = ["task", "goal", "news", "business", "idea"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export type CardPanel = "intelligence" | "markets" | "business" | "studio" | "agents" | "operations";
export type CardOpen = { work: WorkItem } | { panel: CardPanel; view?: "review" } | { memory: string };
export type Candidate = { kind: CardKind; key: string; title: string; detail?: string; base: number; open: CardOpen }; // base: 0..1
export type Card = Candidate & { score: number };
export type Thumb = { kind: string; key: string; up: boolean; at: string };

export const MAX_CARDS = 5;
const DAY = 86_400_000;
const HALF_LIFE = 14 * DAY; // a thumb counts half after two weeks
const MUTE = 7 * DAY; // a 👎 on one exact item hides it for a week
const KEY_MAX = 128; // ledger id length

/** Stable, ledger-safe key for an item. */
export const cardKey = (prefix: string, id: string) => `${prefix}:${id.trim().replace(/\s+/g, " ")}`.slice(0, KEY_MAX);

/** Per-kind multiplier in (0.5, 1.5): decayed net thumbs, squashed so one vote nudges and many saturate. */
export function kindWeights(thumbs: Thumb[], now: number): Record<CardKind, number> {
  const net = Object.fromEntries(CARD_KINDS.map((k) => [k, 0])) as Record<CardKind, number>;
  for (const t of thumbs) {
    const at = Date.parse(t.at);
    if (!(t.kind in net) || !Number.isFinite(at) || at > now) continue;
    net[t.kind as CardKind] += (t.up ? 1 : -1) * 0.5 ** ((now - at) / HALF_LIFE);
  }
  return Object.fromEntries(CARD_KINDS.map((k) => [k, 1 + 0.5 * Math.tanh(net[k] / 3)])) as Record<CardKind, number>;
}

/** Up to MAX_CARDS cards: drops items 👎'd in the last week, reserves one slot per kind that isn't disliked, fills the rest by score. */
export function rankCards(cands: Candidate[], thumbs: Thumb[], now: number, max = MAX_CARDS): Card[] {
  const w = kindWeights(thumbs, now);
  const last = new Map<string, Thumb>(); // newest thumb per key
  for (const t of thumbs) if (Date.parse(t.at) <= now && !(Date.parse(last.get(t.key)?.at ?? "") > Date.parse(t.at))) last.set(t.key, t);
  const seen = new Set<string>();
  const scored = cands.flatMap((c) => {
    const t = last.get(c.key);
    if (seen.has(c.key) || (t && !t.up && now - Date.parse(t.at) < MUTE)) return [];
    seen.add(c.key);
    return [{ ...c, score: Math.max(0, Math.min(1, c.base)) * w[c.kind] + (t?.up ? 0.05 : 0) }];
  }).sort((a, b) => b.score - a.score || CARD_KINDS.indexOf(a.kind) - CARD_KINDS.indexOf(b.kind) || (a.key < b.key ? -1 : 1));
  const picked: Card[] = [];
  for (const k of CARD_KINDS) {
    const best = w[k] >= 0.75 && scored.find((c) => c.kind === k); // tanh(net/3) ≥ -0.5: about two recent 👎 more than 👍 lose the reserved slot
    if (best && picked.length < max) picked.push(best);
  }
  for (const c of scored) if (picked.length < max && !picked.includes(c)) picked.push(c);
  return picked.sort((a, b) => b.score - a.score);
}

/** Which statuses need a decision from you (same set as the briefing's suggestion). */
const DECIDE = ["awaiting_approval", "draft", "waiting", "blocked", "failed"];

/** Candidates from already-gathered morning data; every source is optional. */
export function morningCandidates(x: {
  work?: { items: WorkItem[] }; studioReady?: number; proposals?: string[];
  headlines?: string[]; alerts?: string[]; followups?: { id: string; name: string }[];
  recall?: { id: string; title: string; label: string }[]; ideas?: { id: string; title: string; next: string; score: number }[];
}): Candidate[] {
  const out: Candidate[] = [];
  (x.work?.items ?? []).forEach((it, i) => out.push({
    kind: it.kind, key: cardKey(it.kind, it.id), title: it.title, detail: `${it.action} · ${it.detail}`,
    base: (DECIDE.includes(it.status) ? 0.9 : 0.6) - i * 0.03, open: { work: it },
  }));
  if (x.studioReady) out.push({ kind: "task", key: "studio:review", title: `Review ${x.studioReady} new clip${x.studioReady === 1 ? "" : "s"}`, base: 0.7, open: { panel: "studio", view: "review" } });
  if (x.proposals?.length) out.push({ kind: "task", key: "agents:proposals", title: `Approve or dismiss ${x.proposals.length} agent proposal${x.proposals.length === 1 ? "" : "s"}`, detail: x.proposals[0], base: 0.65, open: { panel: "agents" } });
  (x.alerts ?? []).forEach((a, i) => out.push({ kind: "news", key: cardKey("alert", a), title: a, detail: "Market alert fired today", base: 0.75 - i * 0.05, open: { panel: "markets" } }));
  (x.headlines ?? []).forEach((h, i) => out.push({ kind: "news", key: cardKey("news", h), title: h, detail: "From today's briefing", base: 0.6 - i * 0.1, open: { panel: "intelligence" } }));
  (x.followups ?? []).forEach((p, i) => out.push({ kind: "business", key: cardKey("prospect", p.id), title: `Follow up with ${p.name}`, detail: "No reply after 4+ days", base: 0.8 - i * 0.05, open: { panel: "business" } }));
  (x.recall ?? []).forEach((m, i) => out.push({ kind: "idea", key: cardKey("memory", m.id), title: m.title, detail: `From your memory, ${m.label}`, base: 0.5 - i * 0.05, open: { memory: m.id } }));
  (x.ideas ?? []).forEach((d) => out.push({ kind: "idea", key: cardKey("idea", d.id), title: d.title, detail: d.next, base: Math.min(1, d.score / 100) * 0.6, open: { panel: "agents" } }));
  return out;
}
