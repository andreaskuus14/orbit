// Today's mission: up to MAX_PICKS small targets ticked off from real records (clips scheduled/live today, businesses moved to
// "contacted" or later today, approvals waiting, follow-ups and invoices sent, game dev sessions, study cards), never from what an
// AI or he says he did. He picks the targets (daily-mission.json); nothing picked = the original three. Built in morning.ts.
export type TargetId = "shorts" | "contact" | "approvals" | "followups" | "invoices" | "devsession" | "study";
/** Counts for today; a missing count means its source didn't load, so that item shows "no data" and is never done. */
export type MissionIn = { shortsToday?: number; contactedToday?: number; approvalsWaiting?: number; followupsToday?: number; invoicesToday?: number; devSessionsToday?: number; studyToday?: number };
export type MissionItem = { id: TargetId; label: string; done: boolean; progress: string; noData?: true };
export type Mission = { items: MissionItem[]; done: number; total: number };
export type Target = { id: TargetId; n: number };

export const SHORTS_TARGET = 2, CONTACT_TARGET = 1, MAX_PICKS = 5;
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** The catalogue: only things ORBIT already records. key: the MissionIn count; max: the highest daily target he can set. */
export const CATALOGUE: Record<TargetId, { key: keyof MissionIn; def: number; max: number; label: (k: number) => string }> = {
  shorts: { key: "shortsToday", def: SHORTS_TARGET, max: 10, label: (k) => `Post ${n(k, "Short")}` },
  contact: { key: "contactedToday", def: CONTACT_TARGET, max: 20, label: (k) => `Contact ${n(k, "business", "businesses")}` },
  approvals: { key: "approvalsWaiting", def: 0, max: 0, label: () => "Clear your approvals" },
  followups: { key: "followupsToday", def: 1, max: 20, label: (k) => `Send ${n(k, "follow-up")}` },
  invoices: { key: "invoicesToday", def: 1, max: 20, label: (k) => `Send ${n(k, "invoice")}` },
  devsession: { key: "devSessionsToday", def: 1, max: 5, label: (k) => `Do ${n(k, "game dev session")}` },
  study: { key: "studyToday", def: 20, max: 200, label: (k) => `Review ${n(k, "study card")}` },
};
export const TARGET_IDS = Object.keys(CATALOGUE) as TargetId[];
export const DEFAULT_PICKS: Target[] = [{ id: "shorts", n: SHORTS_TARGET }, { id: "contact", n: CONTACT_TARGET }, { id: "approvals", n: 0 }];

/** His picks from a request body: known ids, once each, at most MAX_PICKS, each target 1..max (approvals has none). [] = back to default. */
export function parsePicks(v: unknown): Target[] | string {
  if (!Array.isArray(v)) return "targets must be a list";
  if (v.length > MAX_PICKS) return `Pick at most ${MAX_PICKS} targets`;
  const out: Target[] = [];
  for (const x of v as { id?: unknown; n?: unknown }[]) {
    const c = CATALOGUE[x?.id as TargetId];
    if (!c || !Object.hasOwn(CATALOGUE, x.id as string)) return `Unknown target: ${String(x?.id)}`;
    if (out.some((p) => p.id === x.id)) return `${String(x.id)} is picked twice`;
    const k = c.max ? Number(x.n ?? c.def) : 0;
    if (c.max && !(Number.isInteger(k) && k >= 1 && k <= c.max)) return `${String(x.id)} target must be 1-${c.max}`;
    out.push({ id: x.id as TargetId, n: k });
  }
  return out;
}

export function dailyMission(x: MissionIn, picks: Target[] = DEFAULT_PICKS): Mission {
  const items = (picks.length ? picks : DEFAULT_PICKS).map((p): MissionItem => {
    const c = CATALOGUE[p.id], v = x[c.key], label = c.label(p.n);
    if (v === undefined) return { id: p.id, label, done: false, progress: "no data", noData: true };
    if (p.id === "approvals") return { id: p.id, label, done: v === 0, progress: v ? `${v} waiting` : "none waiting" };
    return { id: p.id, label, done: v >= p.n, progress: `${Math.min(v, p.n)}/${p.n}` };
  });
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

/** Follow-ups sent today: "sent" timeline events since `from` on a business that already had an earlier "sent" (prospect-crm). */
export function followupsSent(timelines: { at: string; kind: string }[][], from: number): number {
  let k = 0;
  for (const ev of timelines) {
    const sent = ev.filter((e) => e.kind === "sent").map((e) => Date.parse(e.at)).sort((a, b) => a - b);
    k += sent.filter((t, i) => i > 0 && t >= from).length;
  }
  return k;
}

/** One spoken sentence for the briefing. */
export function missionLine(m: Mission): string {
  if (m.done === m.total) return "Today's mission is complete.";
  const left = m.items.filter((i) => !i.done).map((i) => i.label.toLowerCase());
  return `Today's mission: ${left.join(", ")}.`;
}
