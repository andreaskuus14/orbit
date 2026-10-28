// Needs-you inbox, server side (merge: needs-you-pure.ts): reads the existing sources, each soft (a failing source just drops out),
// and never drives anything: missions are read as rows (not listMissions, which reconciles), goals through the read-only work summary.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDay } from "./morning-pure";
import { briefDecisions } from "./brief-pure";
import { briefContracts } from "./contracts-pure";
import { needsYou, reuse, type Need, type NeedsIn } from "./needs-you-pure";
import type { Lang } from "./i18n-pure";

const DAY = 86_400_000;
const soft = <T>(p: PromiseLike<T>, empty: T, ms = 4000): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]).catch((e) => { console.error("[needs-you]", e instanceof Error ? e.message : e); return empty; });

/** approvals: pass the phone's already-loaded list to skip a second read. */
export async function gatherNeeds(sb: SupabaseClient, userId: string, now = Date.now(), lang: Lang = "en", approvals?: NeedsIn["approvals"]): Promise<Need[]> {
  const since = new Date(now - DAY).toISOString(), day = localDay(new Date(now));
  const [rem, night, work, contracts, invoices, missions, loops, conflict, trust, incident, tasks] = await Promise.all([
    approvals ?? soft(import("./remote").then((x) => x.pendingApprovals(sb)), []),
    soft(import("./night").then((x) => x.getNightReport(sb, userId, now)), null),
    soft(import("./work-continuation").then((x) => x.getContinueWork(sb, userId)), null),
    soft(import("./contracts").then((x) => x.listContracts()), []),
    soft(import("./invoices").then((x) => x.allInvoices()), []),
    soft(sb.from("missions").select("id, doc, status, updated_at").eq("user_id", userId).in("status", ["waiting-input", "failed"]).limit(10)
      .then((r) => ((r.data ?? []) as { id: string; doc: { objective?: string; blocker?: string }; status: string; updated_at: string }[])
        .map((m) => ({ id: m.id, objective: m.doc?.objective ?? "", blocker: m.doc?.blocker, status: m.status, updated_at: m.updated_at }))), []),
    soft(import("./loops").then((x) => x.loopsView(sb, userId, now)).then((v) => v.open), []),
    soft(import("./entity-graph").then((x) => x.entitiesBrief(userId)), null),
    soft(Promise.all([import("./autonomy"), import("./trust-pure")]).then(async ([a, t]) => { const s = a.autonomyState(); return t.trustSuggestions(await a.trustHistory(sb, userId), s.levels, s.snooze, now); }), []),
    soft(Promise.all([import("./health"), import("./health-pure")]).then(async ([h, p]) => p.briefHealth(await h.healthIssues(), now)), null),
    soft(sb.from("tasks").select("id, title, finished_at, pending").eq("user_id", userId).is("parent_id", null).eq("status", "done").gte("finished_at", since)
      .order("finished_at", { ascending: false }).limit(10).then((r) => (r.data ?? []) as NonNullable<NeedsIn["tasks"]>), []),
  ]);
  const inv = await import("./invoices-pure").then((x) => x.briefInvoices(invoices, day)).catch(() => []);
  return needsYou({
    approvals: rem, night,
    decisions: [...briefDecisions(night?.approvals ?? [], work?.items ?? [], []), ...briefContracts(contracts), ...inv],
    work: work?.items, missions, loops, conflict, trust, incident, tasks,
  }, lang);
}

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
