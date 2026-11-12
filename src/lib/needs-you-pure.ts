// Needs-you inbox (pure, tested in tests/needs-you.test.ts): one deduplicated list over the places that already ask for him
// (approvals, mission blockers, open loops, "Which is right?", trust suggestions, system incidents, finished results), in three
// kinds: Decide, Unblock, Review result. Each item has ONE action on an existing route. IO: needs-you.ts; route: /api/needs-you;
// UI: NeedsYou.tsx (home HUD) and the phone's "Needs you" section. The morning brief leads with morningPicks() → leadItems().
import type { BriefItem, BriefOpen, Decision } from "./brief-pure";
import type { Loop } from "./loops-pure";
import type { TrustSuggestion } from "./trust-pure";
import type { WorkItem } from "./work-continuation-pure";
import type { WriteEvidence } from "./completion-pure";
import type { Lang } from "./i18n-pure";
import { opsStatus, type OpsStatus } from "./ops-status-pure.ts";
import type { Blocker } from "./business-overview-pure.ts";
import type { ReceiptStatus } from "./receipt-pure.ts";
import { isExpiredError } from "./approval-expiry-pure.ts";

export type NeedKind = "decide" | "unblock" | "review";
/** Always navigate (href = a checked result file). Never a one-tap approve: Decide items open where the exact content and its
 *  Approve live (AGENTS.md rule 6). The phone's own approval cards, which show that exact content, stay the only one-tap path. */
export type NeedAct = { open: BriefOpen };
/** Why it needs him; the UI asks one precise question per cause (needs.ask.<cause>). */
export type NeedCause = "expired" | "approval" | "decide" | "trust" | "conflict" | "system" | "input" | "failed" | "blocked" | "loop" | "review" | "overdue" | "followup" | "delivery" | "watch" | "revisit";
// remote: the phone approval id. status: the shared work status (ops-status-pure) when the item is a task or mission.
// group: set by groupNeeds on a card standing for several similar approvals (its items keep their own refs and actions).
export type Need = { ref: string; kind: NeedKind; cause: NeedCause; title: string; detail?: string; at?: string; act: NeedAct; remote?: string; status?: OpsStatus; group?: Need[] };
type NightItem = { label: string; open?: { task: string } | { goal: string } | { panel: string } };

export type NeedsIn = {
  approvals?: { id: string; key: string; title: string; detail?: string }[]; // remote.ts pendingApprovals (clips, spends, emails, negotiations, invoices)
  decisions?: Decision[]; // brief-pure briefDecisions (night + work, no remote) + briefContracts + briefInvoices
  work?: WorkItem[]; // work-continuation: failed / blocked rows are blockers
  missions?: { id: string; objective: string; status: string; blocker?: string; updated_at: string; chain_id?: string | null }[]; // raw rows: reading never drives a mission
  loops?: Loop[];
  conflict?: { id: string; title: string } | null; // entity-graph-pure contradictionBrief
  trust?: TrustSuggestion[];
  migration?: { id: string; title: string } | null; // version-pure migrationNeed: a guarded migration is missing
  durable?: { id: string; title: string } | null; // durable-pure durableCheck: a failed state write or a given-up event
  incident?: { id: string; title: string } | null; // health-pure briefHealth (new/regressed, serious, last 24 h)
  night?: { done: NightItem[]; failed: NightItem[]; endedAt?: string } | null;
  tasks?: { id: string; title: string; finished_at: string | null; pending?: unknown; status?: string; error?: string | null }[]; // finished top-level tasks of the last day (+ expired approvals)
  // BUSINESS attention (business-overview.ts sources): money owed, clients gone quiet, delivery that waits. now: for "N days".
  overdue?: { id: string; number: string; buyer: string; cents: number; days: number }[];
  followups?: { id: string; name: string; since: string }[]; // since: the last real contact (prospect-crm touch), else the row's updated_at
  delivery?: Blocker[];
  watches?: { id: string; label: string; at: string }[]; // pagewatch-pure importantUnseen: owner-marked watches with an unseen change
  revisits?: { id: string; what: string; revisit: string; daysLate: number }[]; // decisions-pure dueDecisions: decision records whose revisit day (Europe/Tallinn) has come
  now?: number;
};

/** Attention order: money overdue, then everything waiting for his OK, then follow-ups due, then blockers, then results. */
const tier = (n: Need) => (n.cause === "overdue" ? 0 : n.cause === "followup" ? 2 : n.kind === "decide" ? 1 : n.kind === "unblock" ? 3 : 4);
const DAY = 86_400_000;
const MON = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], et: ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"] };
/** "28 Oct" / "28. okt" (UTC date of an ISO time). */
export const shortDay = (iso: string, lang: Lang) => { const d = new Date(iso); return lang === "et" ? `${d.getUTCDate()}. ${MON.et[d.getUTCMonth()]}` : `${d.getUTCDate()} ${MON.en[d.getUTCMonth()]}`; };
const clientLink = (id: string): BriefOpen => ({ link: `#o=business&v=client&k=client&id=${encodeURIComponent(id)}` });
const S = {
  en: { overdue: (no: string, d: number) => `Invoice ${no} is ${d} day${d === 1 ? "" : "s"} overdue`, quiet: (d: number, on: string) => `No reply ${d} day${d === 1 ? "" : "s"} after your message on ${on}`,
    waiting: (on: string) => `Delivery paused since ${on}`, blockedD: (t: string) => `Delivery step failed: ${t}`, trust: (a: string) => `Let ORBIT do ${a} work without asking?`, trustD: (n: number, t: number) => `You approved ${n} of ${t} this month`, failed: "Didn't work out", expired: "Expired: no answer in time, nothing was done", mission: "Mission blocked: ", checked: "Checked result", night: "Finished overnight", watch: "Watched page changed", revisit: (on: string, d: number) => d ? `You planned to revisit this on ${on} (${d} day${d === 1 ? "" : "s"} ago)` : "You planned to revisit this today" },
  et: { overdue: (no: string, d: number) => `Arve ${no} on ${d} päeva üle tähtaja`, quiet: (d: number, on: string) => `Vastust pole ${d} päeva pärast sinu ${on} sõnumit`,
    waiting: (on: string) => `Teostus on ootel alates ${on}`, blockedD: (t: string) => `Teostuse samm ebaõnnestus: ${t}`, trust: (a: string) => `Kas ORBIT võib ${a} töö teha küsimata?`, trustD: (n: number, t: number) => `Kinnitasid sel kuul ${n}/${t}`, failed: "Ei õnnestunud", expired: "Aegus: vastust ei tulnud, midagi ei tehtud", mission: "Missioon seisab: ", checked: "Kontrollitud tulemus", night: "Valmis öösel", watch: "Jälgitav leht muutus", revisit: (on: string, d: number) => d ? `Plaanisid selle üle vaadata ${on} (${d} päeva tagasi)` : "Plaanisid selle täna üle vaadata" },
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
export function needsYou(x: NeedsIn, lang: Lang = "en", snoozed: string[] = []): Need[] {
  const s = S[lang], by = new Map<string, Need>();
  const add = (n: Need) => { // one card per record: the most urgent wins and keeps any phone approval id
    const o = by.get(n.ref);
    if (!o || tier(n) < tier(o)) by.set(n.ref, o ? { ...n, remote: n.remote ?? o.remote } : n);
    else if (n.remote && !o.remote) by.set(n.ref, { ...o, remote: n.remote });
  };
  const now = x.now ?? Date.now();

  // Same refs as the approvals, decisions and loops they upgrade ("invoice:ID", "prospect:ID", "task:ID"), so each record stays one card.
  for (const i of x.overdue ?? []) add({ ref: `invoice:${i.id}`, kind: "decide", cause: "overdue", title: `${i.buyer} · €${(i.cents / 100).toFixed(2)}`, detail: s.overdue(i.number, i.days),
    at: new Date(now - i.days * DAY).toISOString(), act: { open: { link: "#o=business&v=money" } } });
  for (const f of x.followups ?? []) add({ ref: `prospect:${f.id}`, kind: "decide", cause: "followup", title: f.name, detail: s.quiet(Math.floor((now - Date.parse(f.since)) / DAY), shortDay(f.since, lang)), at: f.since, act: { open: clientLink(f.id) } });
  for (const b of x.delivery ?? []) add({ ref: b.ref, kind: "unblock", cause: "delivery", status: b.state === "blocked" ? "failed" : "waiting", title: `${b.client} · ${b.title}`,
    detail: b.state === "waiting" ? s.waiting(shortDay(b.at, lang)) : s.blockedD(b.title), at: b.at, act: { open: b.task ? { task: b.task } : { panel: "operations" } } });

  for (const a of x.approvals ?? []) add({ ref: recordRef(a.key), kind: "decide", cause: "approval", title: a.title, detail: a.detail, remote: a.id, act: { open: approvalOpen(a.key, a.detail) } });
  for (const d of x.decisions ?? []) add({ ref: recordRef(d.id), kind: "decide", cause: "decide", title: d.title, act: { open: d.open ?? { panel: "agents" } } });
  for (const t of x.trust ?? []) add({ ref: `trust:${t.area}`, kind: "decide", cause: "trust", title: s.trust(t.area), detail: s.trustD(t.approved, t.total), act: { open: { panel: "profile" } } }); // Profile → Autonomy has Accept / Not now
  if (x.conflict) add({ ref: x.conflict.id, kind: "decide", cause: "conflict", title: x.conflict.title, act: { open: { panel: "memory" } } });

  if (x.migration) add({ ref: x.migration.id, kind: "unblock", cause: "system", title: x.migration.title, act: { open: { doctor: true } } });
  if (x.durable) add({ ref: x.durable.id, kind: "unblock", cause: "system", title: x.durable.title, act: { open: { doctor: true } } });
  if (x.incident) add({ ref: `health:${x.incident.id}`, kind: "unblock", cause: "system", title: x.incident.title, act: { open: { doctor: true } } });
  for (const m of x.missions ?? []) if (m.status === "waiting-input" || m.status === "failed") // waiting-approval: its task is already a Decide item
    add({ ref: m.chain_id ? `task:${m.chain_id}` : `mission:${m.id}`, kind: "unblock", cause: m.status === "failed" ? "failed" : "input", status: opsStatus(m.status), // one card per task: its chain task's failure is the same cause
      title: s.mission + m.objective.slice(0, 90), detail: m.blocker, at: m.updated_at, act: { open: { panel: "agents" } } });
  for (const w of x.work ?? []) if (w.status === "failed" || w.status === "blocked") add({ ref: `${w.kind}:${w.id}`, kind: "unblock", cause: w.status === "failed" ? "failed" : "blocked", status: opsStatus(w.status), title: w.title, detail: w.detail, act: { open: { work: w } } });
  for (const i of x.night?.failed ?? []) add({ ref: nightRef(i), kind: "unblock", cause: "failed", status: "failed", title: i.label, detail: s.failed, act: { open: nightOpen(i) } });
  for (const l of x.loops ?? []) add({ ref: recordRef(l.key), kind: "unblock", cause: "loop", title: l.title, detail: l.next, at: l.since, act: { open: { mission: true } } });

  for (const t of x.tasks ?? []) {
    if (isExpiredError(t.error)) { add({ ref: `task:${t.id}`, kind: "review", cause: "expired", status: "cancelled", title: t.title, detail: s.expired, at: t.finished_at ?? undefined, act: { open: { task: t.id } } }); continue; }
    const o = t.status && t.status !== "done" ? null : receiptOpen(t.pending); if (o) add({ ref: `task:${t.id}`, kind: "review", cause: "review", status: "complete", title: t.title, detail: s.checked, at: t.finished_at ?? undefined, act: { open: o } }); }
  for (const w of x.watches ?? []) add({ ref: `watch:${w.id}`, kind: "review", cause: "watch", title: w.label, detail: s.watch, at: w.at, act: { open: { link: "#o=intelligence&v=watches" } } });
  for (const r of x.revisits ?? []) add({ ref: `revisit:${r.id}`, kind: "decide", cause: "revisit", title: r.what, detail: s.revisit(shortDay(r.revisit, lang), r.daysLate), at: `${r.revisit}T00:00:00Z`, act: { open: { memory: r.id } } });
  for (const i of x.night?.done ?? []) add({ ref: nightRef(i), kind: "review", cause: "review", title: i.label, detail: s.night, at: x.night?.endedAt, act: { open: nightOpen(i) } });

  const t = (n: Need) => Date.parse(n.at ?? "") || 0;
  for (const r of snoozed) by.delete(r); // snoozed with a reason until tomorrow (brief.json snoozes)
  const aged = (n: Need) => n.cause === "overdue" || n.cause === "followup" || n.cause === "delivery";
  // Review: newest first. Money, follow-ups and delivery: oldest first. Sort is stable: source order otherwise.
  return [...by.values()].sort((a, b) => tier(a) - tier(b) || (a.kind === "review" ? t(b) - t(a) : aged(a) && aged(b) ? t(a) - t(b) : 0));
}

/** Many similar approvals (22 Shorts from one source video) → ONE card at the first one's place (ranking unchanged), with the
 *  members in `group`. Similar = same source kind (ref prefix), same detail line ("Short from X") and the same place to review
 *  them, so "Review all" opens exactly where each member's own Review would. Fewer than `min` stay separate. */
export function groupNeeds(needs: Need[], min = 3): Need[] {
  const key = (n: Need) => (n.cause === "approval" && !n.group ? `${n.ref.split(":")[0]}|${n.detail ?? ""}|${JSON.stringify(n.act.open)}` : "");
  const by = new Map<string, Need[]>();
  for (const n of needs) { const k = key(n); if (k) by.set(k, [...(by.get(k) ?? []), n]); }
  const out: Need[] = [];
  for (const n of needs) {
    const g = by.get(key(n));
    if (!g || g.length < min) out.push(n);
    else if (g[0] === n) out.push({ ...n, ref: `group:${n.ref}`, title: n.detail ?? n.title, detail: undefined, remote: undefined, group: g });
  }
  return out;
}

/** Where a phone approval is decided on the PC (same targets as brief-pure briefDecisions). */
function approvalOpen(key: string, detail = ""): BriefOpen {
  const k = key.split(":")[0];
  return k === "clip" ? { panel: "studio", view: "review" } : k === "spend" ? { panel: "studio" } : k === "nego" && detail.startsWith("Deal") ? { panel: "markets", tab: "Deals" } : { panel: "business" };
}

/** The morning's three: one finished artifact that has a link, one decision, one next action. Missing ones stay missing. */
export function morningPicks(needs: Need[]): { artifact?: Need; decision?: Need; next?: Need } {
  return {
    artifact: needs.find((n) => n.kind === "review" && "href" in n.act.open),
    decision: needs.find((n) => n.kind === "decide"),
    next: needs.find((n) => n.kind === "unblock"),
  };
}

/** The brief's lead lines (English: the brief is spoken in English). Decision ids match brief-pure's, so it is never said twice. */
export function leadItems(p: ReturnType<typeof morningPicks>): BriefItem[] {
  const out: BriefItem[] = [];
  const clean = (t: string) => t.replace(/[“”"]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  const { artifact: a, decision: d, next: n } = p;
  if (a) out.push({ id: `artifact:${a.ref}`, kind: "result", title: clean(a.title), detail: "Finished and checked: open it", open: a.act.open, say: `Finished and checked: ${clean(a.title)}. The link is on the card.` });
  if (d) out.push({ id: `decision:${d.remote && !d.ref.startsWith("invoice:") ? d.remote : d.ref}`, kind: "decision", title: clean(d.title), detail: "Needs your OK",
    open: d.act.open, say: `One decision for you: ${clean(d.title)}.` });
  if (n) out.push({ id: `next:${n.ref}`, kind: "first", title: clean(n.title), detail: n.detail && clean(n.detail), open: n.act.open, say: `Next: ${clean(n.title)}.` });
  return out;
}

/** A cached result while it is younger than ttl (the phone polls every 20 s; the inbox is gathered at most once a minute). */
export const reuse = <T>(c: { at: number; v: T } | undefined, now: number, ttl = 60_000): T | undefined => (c && now >= c.at && now - c.at < ttl ? c.v : undefined);

// "What finished, what's blocked, what I need from you": one compact answer on top of this card, for the last 24 h or since he
// was last here (whichever is longer). Finished = receipts (receipt-pure.ts), never a bare "done"; blocked / decide = this list.
export type DigestReceipt = { at: string; status: ReceiptStatus; title: string };
export type Digest = { from: string; finished: Record<ReceiptStatus, number>; lines: string[] };
const DG = {
  en: { window: (away: boolean, d: string) => (away ? `since you were last here (${d})` : "in the last 24 h"), none: "Nothing finished", fin: (n: number) => `${n} finished`,
    st: { verified: "verified", partly: "partly done", unverified: "not verified", failed: "failed" }, blocked: (n: number, t: string) => `${n} blocked, first: ${t}`, noBlock: "Nothing blocked",
    decide: (n: number, t: string) => `${n} need${n === 1 ? "s" : ""} your decision, first: ${t}`, noDecide: "Nothing needs your decision" },
  et: { window: (away: boolean, d: string) => (away ? `pärast su viimast külastust (${d})` : "viimase 24 h jooksul"), none: "Midagi ei valminud", fin: (n: number) => `${n} valmis`,
    st: { verified: "kontrollitud", partly: "osaliselt", unverified: "kontrollimata", failed: "ebaõnnestus" }, blocked: (n: number, t: string) => `${n} seisab, esimene: ${t}`, noBlock: "Midagi ei seisa",
    decide: (n: number, t: string) => `${n} ootab su otsust, esimene: ${t}`, noDecide: "Sinu otsust pole vaja" },
};
/** Three lines: finished (by proof status), blocked, needs his decision. `lastActive`: ms epoch, or null/0 when unknown. */
export function doneDigest(needs: Need[], receipts: DigestReceipt[], now: number, lastActive: number | null, lang: Lang = "en"): Digest {
  const s = DG[lang], from = Math.min(now - DAY, lastActive && lastActive > now - 7 * DAY ? lastActive : now);
  const fin: Record<ReceiptStatus, number> = { verified: 0, partly: 0, unverified: 0, failed: 0 };
  for (const r of receipts) if (Date.parse(r.at) >= from && Date.parse(r.at) <= now) fin[r.status]++;
  const total = Object.values(fin).reduce((a, b) => a + b, 0), parts = (Object.keys(fin) as ReceiptStatus[]).filter((k) => fin[k]).map((k) => `${fin[k]} ${s.st[k]}`);
  const blocked = needs.filter((n) => n.kind === "unblock"), decide = needs.filter((n) => n.kind === "decide");
  const short = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 70);
  const when = s.window(from < now - DAY, shortDay(new Date(from).toISOString(), lang));
  return { from: new Date(from).toISOString(), finished: fin, lines: [
    total ? `${s.fin(total)} ${when}: ${parts.join(", ")}` : `${s.none} ${when}`,
    blocked.length ? s.blocked(blocked.length, short(blocked[0].title)) : s.noBlock,
    decide.length ? s.decide(decide.length, short(decide[0].title)) : s.noDecide,
  ] };
}
