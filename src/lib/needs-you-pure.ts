// Needs-you inbox (pure, tested in tests/needs-you.test.ts): one deduplicated list over the places that already ask for him
// (approvals, mission blockers, open loops, "Which is right?", trust suggestions, system incidents, finished results), in three
// kinds: Decide, Unblock, Review result. Each item has ONE action on an existing route. IO: needs-you.ts; route: /api/needs-you;
// UI: NeedsYou.tsx (home HUD) and the phone's "Needs you" section. The morning brief leads with morningPicks() → leadItems().
import type { BriefApprove, BriefItem, BriefOpen, Decision } from "./brief-pure";
import type { Loop } from "./loops-pure";
import type { TrustSuggestion } from "./trust-pure";
import type { WorkItem } from "./work-continuation-pure";
import type { WriteEvidence } from "./completion-pure";
import type { Lang } from "./i18n-pure";

export type NeedKind = "decide" | "unblock" | "review";
/** approve: brief-pure's one-tap routes; trust: POST /api/autonomy {action:"level", area, level:"do"}; open: navigate (href = a result file). */
export type NeedAct = { approve: BriefApprove } | { trust: string } | { open: BriefOpen };
export type Need = { ref: string; kind: NeedKind; title: string; detail?: string; at?: string; act: NeedAct; remote?: string }; // remote: the phone approval id
type NightItem = { label: string; open?: { task: string } | { goal: string } | { panel: string } };

export type NeedsIn = {
  approvals?: { id: string; key: string; title: string; detail?: string }[]; // remote.ts pendingApprovals (clips, spends, emails, negotiations, invoices)
  decisions?: Decision[]; // brief-pure briefDecisions (night + work, no remote) + briefContracts + briefInvoices
  work?: WorkItem[]; // work-continuation: failed / blocked rows are blockers
  missions?: { id: string; objective: string; status: string; blocker?: string; updated_at: string }[]; // raw rows: reading never drives a mission
  loops?: Loop[];
  conflict?: { id: string; title: string } | null; // entity-graph-pure contradictionBrief
  trust?: TrustSuggestion[];
  incident?: { id: string; title: string } | null; // health-pure briefHealth (new/regressed, serious, last 24 h)
  night?: { done: NightItem[]; failed: NightItem[]; endedAt?: string } | null;
  tasks?: { id: string; title: string; finished_at: string | null; pending?: unknown }[]; // finished top-level tasks of the last day
};

const RANK: Record<NeedKind, number> = { decide: 0, unblock: 1, review: 2 };
const S = {
  en: { trust: (a: string) => `Let ORBIT do ${a} work without asking?`, trustD: (n: number, t: number) => `You approved ${n} of ${t} this month`, failed: "Didn't work out", mission: "Mission blocked: ", checked: "Checked result", night: "Finished overnight" },
  et: { trust: (a: string) => `Kas ORBIT võib ${a} töö teha küsimata?`, trustD: (n: number, t: number) => `Kinnitasid sel kuul ${n}/${t}`, failed: "Ei õnnestunud", mission: "Missioon seisab: ", checked: "Kontrollitud tulemus", night: "Valmis öösel" },
};

/** The record behind a source key, so one draft is one item: "approval:prospect:ID:day", "send:ID" and "prospect:ID:day" → "prospect:ID". */
export function recordRef(key: string): string {
  const k = key.replace(/^approval:/, "").replace(/^send:/, "prospect:");
  const [kind, id] = k.split(":");
  return id ? `${kind}:${id}` : k;
}

const nightRef = (i: NightItem) => (i.open && "task" in i.open ? `task:${i.open.task}` : i.open && "goal" in i.open ? `goal:${i.open.goal}` : `night:${i.label.slice(0, 80)}`);
const nightOpen = (i: NightItem): BriefOpen => (i.open && "task" in i.open ? { task: i.open.task } : i.open && "goal" in i.open ? { goal: i.open.goal } : { panel: "agents" });

/** A finished task's receipt (read-back checks only, never the model's say-so): a workspace file link, else a saved memory. */
export function receiptOpen(pending: unknown): BriefOpen | null {
  const ev = (Array.isArray(pending) ? pending : []).flatMap((p) => (p && Array.isArray((p as { evidence?: unknown }).evidence) ? (p as { evidence: WriteEvidence[] }).evidence : []));
  const f = ev.find((e) => e?.kind === "file" && typeof e.id === "string" && e.path);
  if (f) return { href: `/api/workspace?ws=${encodeURIComponent(f.id)}&file=${encodeURIComponent(f.path!)}&open=1` };
  const m = ev.find((e) => e?.kind === "memory" && typeof e.id === "string");
  return m ? { memory: m.id } : null;
}

/** Merge every source into one list: Decide, then Unblock, then Review (newest first). The same record appears once, as its most
 *  urgent kind (an approval that is also an open loop stays one Decide card). */
export function needsYou(x: NeedsIn, lang: Lang = "en"): Need[] {
  const s = S[lang], by = new Map<string, Need>();
  const add = (n: Need) => { const o = by.get(n.ref); if (!o || RANK[n.kind] < RANK[o.kind]) by.set(n.ref, o ? { ...n, remote: n.remote ?? o.remote } : n); };

  for (const a of x.approvals ?? []) add({ ref: recordRef(a.key), kind: "decide", title: a.title, detail: a.detail, remote: a.id, act: { open: approvalOpen(a.key, a.detail) } });
  for (const d of x.decisions ?? []) add({ ref: recordRef(d.id), kind: "decide", title: d.title, act: d.approve ? { approve: d.approve } : { open: d.open ?? { panel: "agents" } } });
  for (const t of x.trust ?? []) add({ ref: `trust:${t.area}`, kind: "decide", title: s.trust(t.area), detail: s.trustD(t.approved, t.total), act: { trust: t.area } });
  if (x.conflict) add({ ref: x.conflict.id, kind: "decide", title: x.conflict.title, act: { open: { panel: "memory" } } });

  if (x.incident) add({ ref: `health:${x.incident.id}`, kind: "unblock", title: x.incident.title, act: { open: { doctor: true } } });
  for (const m of x.missions ?? []) if (m.status === "waiting-input" || m.status === "failed") // waiting-approval: its task is already a Decide item
    add({ ref: `mission:${m.id}`, kind: "unblock", title: s.mission + m.objective.slice(0, 90), detail: m.blocker, at: m.updated_at, act: { open: { panel: "agents" } } });
  for (const w of x.work ?? []) if (w.status === "failed" || w.status === "blocked") add({ ref: `${w.kind}:${w.id}`, kind: "unblock", title: w.title, detail: w.detail, act: { open: { work: w } } });
  for (const i of x.night?.failed ?? []) add({ ref: nightRef(i), kind: "unblock", title: i.label, detail: s.failed, act: { open: nightOpen(i) } });
  for (const l of x.loops ?? []) add({ ref: recordRef(l.key), kind: "unblock", title: l.title, detail: l.next, at: l.since, act: { open: { mission: true } } });

  for (const t of x.tasks ?? []) { const o = receiptOpen(t.pending); if (o) add({ ref: `task:${t.id}`, kind: "review", title: t.title, detail: s.checked, at: t.finished_at ?? undefined, act: { open: o } }); }
  for (const i of x.night?.done ?? []) add({ ref: nightRef(i), kind: "review", title: i.label, detail: s.night, at: x.night?.endedAt, act: { open: nightOpen(i) } });

  const t = (n: Need) => Date.parse(n.at ?? "") || 0;
  return [...by.values()].sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.kind === "review" ? t(b) - t(a) : 0)); // sort is stable: source order otherwise
}

/** Where a phone approval is decided on the PC (same targets as brief-pure briefDecisions). */
function approvalOpen(key: string, detail = ""): BriefOpen {
  const k = key.split(":")[0];
  return k === "clip" ? { panel: "studio", view: "review" } : k === "spend" ? { panel: "studio" } : k === "nego" && detail.startsWith("Deal") ? { panel: "markets", tab: "Deals" } : { panel: "business" };
}

/** The morning's three: one finished artifact that has a link, one decision, one next action. Missing ones stay missing. */
export function morningPicks(needs: Need[]): { artifact?: Need; decision?: Need; next?: Need } {
  return {
    artifact: needs.find((n) => n.kind === "review" && "open" in n.act && "href" in n.act.open),
    decision: needs.find((n) => n.kind === "decide"),
    next: needs.find((n) => n.kind === "unblock"),
  };
}

/** The brief's lead lines (English: the brief is spoken in English). Decision ids match brief-pure's, so it is never said twice. */
export function leadItems(p: ReturnType<typeof morningPicks>): BriefItem[] {
  const out: BriefItem[] = [];
  const clean = (t: string) => t.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  const { artifact: a, decision: d, next: n } = p;
  if (a && "open" in a.act) out.push({ id: `artifact:${a.ref}`, kind: "result", title: clean(a.title), detail: "Finished and checked: open it", open: a.act.open, say: `Finished and checked: ${clean(a.title)}. The link is on the card.` });
  if (d) out.push({ id: `decision:${d.remote && !d.ref.startsWith("invoice:") ? d.remote : d.ref}`, kind: "decision", title: clean(d.title), detail: "Needs your OK",
    ...("approve" in d.act ? { approve: d.act.approve } : "open" in d.act ? { open: d.act.open } : { open: { panel: "profile" as const } }), say: `One decision for you: ${clean(d.title)}.` });
  if (n && "open" in n.act) out.push({ id: `next:${n.ref}`, kind: "first", title: clean(n.title), detail: n.detail && clean(n.detail), open: n.act.open, say: `Next: ${clean(n.title)}.` });
  return out;
}
