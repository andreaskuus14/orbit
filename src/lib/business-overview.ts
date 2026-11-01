// BUSINESS overview IO (rules: business-overview-pure.ts). Reads invoices.json, the prospects table (+ prospect-crm timelines),
// paying clients' OPERATIONS delivery projects and the Money monthly target. Read only. A source that fails falls back to its
// last good read this process made (shown as "updated <time>"), else null ("no data"). Needs you reuses the same sources.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDay } from "./morning-pure";
import { businessOverview, deliveryBlockers, type Blocker, type Overview, type OverviewIn, type Src } from "./business-overview-pure";
import type { Prospect } from "./business-pure";
import type { Invoice } from "./invoices-pure";

type Rows = NonNullable<OverviewIn["prospects"]>["data"];
const g = globalThis as unknown as { __orbitBizLast?: Map<string, { data: unknown; at: string }> };
const last = (g.__orbitBizLast ??= new Map());

/** Read once; on failure serve the last good read (stale), else null. */
async function src<T>(key: string, read: () => Promise<T>, now: number): Promise<Src<T>> {
  try { const data = await read(), at = new Date(now).toISOString(); last.set(key, { data, at }); return { data, at }; }
  catch (e) {
    console.error("[business-overview]", key, e instanceof Error ? e.message : e);
    const l = last.get(key) as { data: T; at: string } | undefined;
    return l ? { ...l, stale: true } : null;
  }
}

async function prospects(sb: SupabaseClient): Promise<Rows> {
  const { data, error } = await sb.from("prospects").select("id,name,kind,contact,stage,fee,notes,updated_at,created_at").limit(1000);
  if (error) throw new Error(error.message);
  return import("./prospect-crm").then((c) => c.withTouch((data ?? []) as Prospect[]));
}

async function blockers(sb: SupabaseClient, ps: { id: string; name: string; stage: string }[], now: number): Promise<Blocker[]> {
  const crm = await import("./prospect-crm").then((c) => c.loadCrm());
  const clients = ps.flatMap((p) => (p.stage === "paying" && crm[p.id]?.opsProject ? [{ id: p.id, name: p.name, project: crm[p.id].opsProject! }] : []));
  if (!clients.length) return [];
  const ids = clients.map((c) => c.project);
  const [pr, tk] = await Promise.all([
    sb.from("projects").select("id,name,status,updated_at").in("id", ids),
    sb.from("tasks").select("id,title,project_id,finished_at").in("project_id", ids).is("parent_id", null).eq("status", "failed").limit(50),
  ]);
  if (pr.error || tk.error) throw new Error((pr.error ?? tk.error)!.message);
  return deliveryBlockers(clients, pr.data ?? [], tk.data ?? [], now);
}

/** The raw sources, each soft. userId keys the last-good cache. */
export async function businessSources(sb: SupabaseClient, userId: string, now = Date.now()) {
  const [invoices, ps, target] = await Promise.all([
    src<Invoice[]>(`${userId}:invoices`, () => import("./invoices").then((x) => x.allInvoices()), now),
    src<Rows>(`${userId}:prospects`, () => prospects(sb), now),
    import("./money").then((m) => m.moneySettings()).then((s) => Number(s.revenueTarget) || 0, () => 0),
  ]);
  const bl = ps && !ps.stale ? await src<Blocker[]>(`${userId}:blockers`, () => blockers(sb, ps.data, now), now) : (last.has(`${userId}:blockers`) ? { ...(last.get(`${userId}:blockers`) as { data: Blocker[]; at: string }), stale: true } : null);
  return { invoices, prospects: ps, blockers: bl, target };
}

export async function getOverview(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Overview> {
  return businessOverview({ now, today: localDay(new Date(now)), ...(await businessSources(sb, userId, now)) });
}
