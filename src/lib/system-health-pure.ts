// System health (roadmap 9.5), pure part; tested in tests/system-health.test.ts. IO: system-health.ts, shown in DoctorPanel's SYSTEM card.
// One view of services (with last success), failed jobs, storage, models and budgets, plus an incident model: each problem has a dedupe
// key, is alerted once (after two checks in a row, outside quiet hours), can be acknowledged, and resolves by itself when it's gone.
import { diskCheck, type Status } from "./doctor-pure.ts";
import { translate, tx, type Lang } from "./i18n-pure.ts";

export type SvcState = "ok" | "down" | "off"; // off = not set up / not used
export type Probe = { id: string; label: string; state: SvcState; detail: string; okAt?: string | null }; // okAt: a success the probe knows of
export type Svc = Omit<Probe, "okAt"> & { lastOk: string | null };

/** Probes + the remembered last successes → rows; a success only ever moves lastOk forward. */
export function mergeServices(probes: Probe[], prev: Record<string, string>): { services: Svc[]; lastOk: Record<string, string> } {
  const lastOk = { ...prev };
  const services = probes.map(({ okAt, ...p }) => {
    if (okAt && (!lastOk[p.id] || okAt > lastOk[p.id])) lastOk[p.id] = okAt;
    return { ...p, lastOk: lastOk[p.id] ?? null };
  });
  return { services, lastOk };
}

// ---- Failed jobs ----------------------------------------------------------------
export const JOB_KINDS = ["task", "mission", "night", "clip"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type Failure = { kind: JobKind; label: string; at: string };
export type FailedGroup = { kind: JobKind; count: number; recent: Failure[] };
const WEEK = 7 * 86_400_000;

/** Failures in the last 7 days per kind (every kind listed, zeros too), newest 3 each. */
export function failedJobs(list: Failure[], now: number): FailedGroup[] {
  const recent = list.filter((f) => now - Date.parse(f.at) < WEEK).sort((a, b) => b.at.localeCompare(a.at));
  return JOB_KINDS.map((kind) => { const k = recent.filter((f) => f.kind === kind); return { kind, count: k.length, recent: k.slice(0, 3) }; });
}

// ---- Storage --------------------------------------------------------------------
export type Storage = { id: string; label: string; dir: string; free: number | null; status: Status };
/** Same thresholds as the doctor's disk check (5 GB fail, 20 GB warn); null free = couldn't read the drive. */
export const storageRow = (id: string, label: string, dir: string, free: number | null): Storage =>
  ({ id, label, dir, free, status: free == null ? "warn" : diskCheck(free, dir).status });

// ---- Models -----------------------------------------------------------------------
export type CallLite = { at: number; model: string; ok: boolean };
export type ModelRow = { role: string; model: string; state: "ok" | "failing" | "unused" | "limited"; lastOk: number | null; calls7d: number };

/** Per configured model: available when its last call worked; failing when its last call failed; limited while a usage limit holds. */
export function modelRows(models: Record<string, string>, calls: CallLite[], limited: boolean, now: number): ModelRow[] {
  return Object.entries(models).filter(([, m]) => m).map(([role, model]) => {
    const mine = calls.filter((c) => c.model === model && now - c.at < WEEK).sort((a, b) => a.at - b.at);
    const last = mine.at(-1), ok = mine.filter((c) => c.ok).at(-1);
    return { role, model, calls7d: mine.length, lastOk: ok?.at ?? null, state: limited ? "limited" : !last ? "unused" : last.ok ? "ok" : "failing" };
  });
}

/** Used vs a budget; null budget = none set. */
export const budget = (used: number, cap: number | null) => ({ used, cap, pct: cap && cap > 0 ? Math.round((used / cap) * 100) : null });

// ---- Incidents ------------------------------------------------------------------
export type IncState = "open" | "ack" | "resolved";
export type Problem = { key: string; title: string };
export type Incident = { key: string; title: string; state: IncState; opened: string; lastSeen: string; seen: number; alertedAt?: string; resolvedAt?: string };
export const CONFIRM = 2; // checks in a row before a push: one blip (a Supabase hiccup) is not an incident worth waking a phone for
const KEEP_RESOLVED_MS = WEEK;

/** Current state → the problems worth an incident: services down, a drive under 5 GB, an active Claude usage limit. */
export function problems(services: Svc[], storage: Storage[], limitUntil: number | null): Problem[] {
  return [
    ...services.filter((s) => s.state === "down").map((s) => ({ key: `svc:${s.id}`, title: translate("en", "sys.inc.down", { label: s.label }) })),
    ...storage.filter((s) => s.status === "fail").map((s) => ({ key: `disk:${s.id}`, title: translate("en", "sys.inc.disk", { label: s.label }) })),
    ...(limitUntil ? [{ key: "claude:limit", title: translate("en", "sys.inc.limit") }] : []),
  ];
}

/** An incident's title in the UI language, rebuilt from its key (svc:<id> / disk:<id> / claude:limit); the stored English title is the fallback. */
export function incidentTitle(i: Problem, lang: Lang): string {
  const [kind, id] = i.key.split(":");
  if (lang === "en") return i.title;
  if (i.key === "claude:limit") return translate(lang, "sys.inc.limit");
  if (kind === "svc") return translate(lang, "sys.inc.down", { label: tx(lang, `svc.${id}`, i.title.replace(/ is down$/, "")) });
  if (kind === "disk") return translate(lang, "sys.inc.disk", { label: tx(lang, `disk.${id}`, i.title.replace(/: disk almost full$/, "")) });
  return i.title;
}

/** One check: problems still present stay one incident per key (dedupe), new ones open, missing ones resolve. Returns the incidents
 *  and which ones to alert now: open (not acknowledged), seen CONFIRM times, never alerted, outside quiet hours. A resolved key that
 *  comes back is a new incident (alerted again). Resolved ones are kept a week for the card. */
export function reconcile(prev: Incident[], now: Problem[], at: number, quiet: boolean): { incidents: Incident[]; alert: Incident[] } {
  const iso = new Date(at).toISOString(), live = new Map(now.map((p) => [p.key, p]));
  const out: Incident[] = [], alert: Incident[] = [], active = new Set<string>();
  for (const i of prev) {
    if (i.state === "resolved") { if (at - Date.parse(i.resolvedAt ?? i.lastSeen) < KEEP_RESOLVED_MS) out.push(i); continue; }
    const p = live.get(i.key);
    if (!p) { out.push({ ...i, state: "resolved", resolvedAt: iso }); continue; }
    active.add(i.key);
    out.push({ ...i, title: p.title, lastSeen: iso, seen: i.seen + 1 });
  }
  for (const p of live.values()) if (!active.has(p.key)) { active.add(p.key); out.push({ key: p.key, title: p.title, state: "open", opened: iso, lastSeen: iso, seen: 1 }); }
  for (let k = 0; k < out.length; k++) {
    const i = out[k];
    if (i.state === "open" && !i.alertedAt && i.seen >= CONFIRM && !quiet) { out[k] = { ...i, alertedAt: iso }; alert.push(out[k]); }
  }
  return { incidents: out, alert };
}

/** The owner's "Got it": no push for it any more; it still resolves by itself. */
export const ackIncident = (list: Incident[], key: string): Incident[] => list.map((i) => (i.key === key && i.state === "open" ? { ...i, state: "ack" } : i));

/** Open first, then acknowledged, then resolved; newest first within each. */
export const sortIncidents = (list: Incident[]) => {
  const r: Record<IncState, number> = { open: 0, ack: 1, resolved: 2 };
  return [...list].sort((a, b) => r[a.state] - r[b.state] || b.lastSeen.localeCompare(a.lastSeen));
};

/** health.json-style store text → its parts; anything malformed is dropped (it's only a cache of what checks found). */
export function parseStore(raw: string | null): { lastOk: Record<string, string>; incidents: Incident[]; lastCheck: number } {
  let o: { lastOk?: unknown; incidents?: unknown; lastCheck?: unknown };
  try { o = JSON.parse(raw ?? ""); } catch { o = {}; }
  const lastOk = o && typeof o.lastOk === "object" && o.lastOk ? Object.fromEntries(Object.entries(o.lastOk).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
  const incidents = Array.isArray(o?.incidents) ? (o.incidents as Incident[]).filter((i) => i && typeof i.key === "string" && typeof i.title === "string"
    && ["open", "ack", "resolved"].includes(i.state) && typeof i.opened === "string" && typeof i.lastSeen === "string" && typeof i.seen === "number") : [];
  return { lastOk, incidents, lastCheck: typeof o?.lastCheck === "number" ? o.lastCheck : 0 };
}
