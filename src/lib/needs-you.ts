// Needs-you inbox, server side (merge: needs-you-pure.ts): reads the existing sources, each soft (a failing source just drops out),
// and never drives anything: missions are read as rows (not listMissions, which reconciles), goals through the read-only work summary.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDay } from "./morning-pure";
import { briefDecisions } from "./brief-pure";
import { briefContracts } from "./contracts-pure";
import { briefInvoices, daysLate, isOverdue, totals } from "./invoices-pure";
import { dueFollowups } from "./business-pure";
import { doneDigest, needsYou, reuse, type DigestReceipt, type Need, type NeedsIn } from "./needs-you-pure";
import { rowReceipt } from "./receipt-pure";
import type { Lang } from "./i18n-pure";

const DAY = 86_400_000;
const soft = <T>(p: PromiseLike<T>, empty: T, ms = 4000): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]).catch((e) => { console.error("[needs-you]", e instanceof Error ? e.message : e); return empty; });

/** approvals: pass the phone's already-loaded list to skip a second read. */
export async function gatherNeeds(sb: SupabaseClient, userId: string, now = Date.now(), lang: Lang = "en", approvals?: NeedsIn["approvals"]): Promise<Need[]> {
  const since = new Date(now - DAY).toISOString(), day = localDay(new Date(now));
  const [rem, night, work, contracts, biz, missions, loops, conflict, trust, incident, tasks, migration, durable, watches] = await Promise.all([
    approvals ?? soft(import("./remote").then((x) => x.pendingApprovals(sb)), []),
    soft(import("./night").then((x) => x.getNightReport(sb, userId, now)), null),
    soft(import("./work-continuation").then((x) => x.getContinueWork(sb, userId)), null),
    soft(import("./contracts").then((x) => x.listContracts()), []),
    soft(import("./business-overview").then((x) => x.businessSources(sb, userId, now)), null), // invoices, prospects, delivery blockers
    soft(sb.from("missions").select("id, chain_id, doc, status, updated_at").eq("user_id", userId).in("status", ["waiting-input", "failed"]).limit(10)
      .then((r) => ((r.data ?? []) as { id: string; chain_id: string | null; doc: { objective?: string; blocker?: string }; status: string; updated_at: string }[])
        .map((m) => ({ id: m.id, chain_id: m.chain_id, objective: m.doc?.objective ?? "", blocker: m.doc?.blocker, status: m.status, updated_at: m.updated_at }))), []),
    soft(import("./loops").then((x) => x.loopsView(sb, userId, now)).then((v) => v.open), []),
    soft(import("./entity-graph").then((x) => x.entitiesBrief(userId)), null),
    soft(Promise.all([import("./autonomy"), import("./trust-pure")]).then(async ([a, t]) => { const s = a.autonomyState(); return t.trustSuggestions(await a.trustHistory(sb, userId), s.levels, s.snooze, now); }), []),
    soft(Promise.all([import("./health"), import("./health-pure")]).then(async ([h, p]) => p.briefHealth(await h.healthIssues(), now)), null),
    soft(sb.from("tasks").select("id, title, finished_at, pending").eq("user_id", userId).is("parent_id", null).eq("status", "done").gte("finished_at", since)
      .order("finished_at", { ascending: false }).limit(10).then((r) => (r.data ?? []) as NonNullable<NeedsIn["tasks"]>), []),
    soft(Promise.all([import("./migration-guard"), import("./version-pure")]).then(async ([m, v]) => v.migrationNeed(await m.missingGuarded(sb))), null),
    soft(Promise.all([import("./durable"), import("./durable-pure")]).then(([d, p]) => { const c = p.durableCheck(d.writeFailures(), d.deadEvents()); return c.status === "ok" ? null : { id: "durable", title: c.detail.slice(0, 160) }; }), null),
    soft(Promise.all([import("./pagewatch"), import("./pagewatch-pure")]).then(async ([w, p]) => p.importantUnseen(await w.watchStore())), []),
  ]);
  const snoozed = await import("./brief").then((b) => b.snoozedIds(userId, NEED_SNOOZE, now)).catch(() => []);
  const invoices = biz?.invoices?.data ?? [];
  const inv = briefInvoices(invoices, day);
  const overdue = invoices.filter((i) => isOverdue(i, day)).map((i) => ({ id: i.id, number: i.number, buyer: i.buyer.name, cents: totals(i).gross, days: daysLate(i, day) }));
  const followups = dueFollowups(biz?.prospects?.data ?? [], now).map((p) => ({ id: p.id, name: p.name, since: p.touch?.last ?? p.updated_at }));
  return needsYou({
    approvals: rem, night,
    decisions: [...briefDecisions(night?.approvals ?? [], work?.items ?? [], []), ...briefContracts(contracts), ...inv],
    work: work?.items, missions, loops, conflict, trust, incident, migration, durable, tasks,
    overdue, followups, delivery: biz?.blockers?.data ?? [], watches, now,
  }, lang, snoozed);
}

/** brief.json snooze id prefix for a Needs-you item (its ref follows). */
export const NEED_SNOOZE = "need:";

const cache = new Map<string, { at: number; v: Promise<Need[]> }>(); // user + lang → the last gather (the phone's 20 s poll)
/** gatherNeeds at most once a minute per user and language; a failed gather is not kept. */
export function cachedNeeds(sb: SupabaseClient, userId: string, lang: Lang, approvals?: NeedsIn["approvals"], now = Date.now()): Promise<Need[]> {
  const key = `${userId}:${lang}`, hit = reuse(cache.get(key), now);
  if (hit) return hit;
  const v = gatherNeeds(sb, userId, now, lang, approvals);
  cache.set(key, { at: now, v });
  v.catch(() => cache.delete(key));
  return v;
}

/** The card's digest: receipts of top-level tasks / background jobs and of CORE turns (Activity) since `from`, plus this list. */
export async function gatherDigest(sb: SupabaseClient, userId: string, needs: Need[], now: number, lastActive: number | null, lang: Lang) {
  const from = new Date(Math.min(now - DAY, lastActive ?? now) - 60_000).toISOString(); // doneDigest clamps the window itself
  const [tasks, acts] = await Promise.all([
    soft(sb.from("tasks").select("title, request, status, error, pending, trace, finished_at").eq("user_id", userId).is("parent_id", null).in("status", ["done", "failed", "cancelled"])
      .gte("finished_at", from).limit(100).then((r) => (r.data ?? []) as (Parameters<typeof rowReceipt>[0] & { finished_at: string })[]), []),
    soft(import("./activity").then((a) => a.readActivity()), []),
  ]);
  const receipts: DigestReceipt[] = [
    ...tasks.flatMap((t) => { const r = rowReceipt(t); return r ? [{ at: t.finished_at, status: r.status, title: t.title }] : []; }),
    ...acts.filter((a) => a.area === "core" && a.receipt && a.at >= from).map((a) => ({ at: a.at, status: a.receipt!, title: a.title })),
  ];
  return doneDigest(needs, receipts, now, lastActive, lang);
}
