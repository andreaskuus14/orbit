// Which STUDIO failures still deserve an alert, grouped per source. Pure; used by StudioNotifier (alerts) and ClipFactory (Failed view).
type Job = { id: string; status: string; source?: string; error?: string; createdAt?: string; updatedAt?: string };
type Dl = { id: string; status: string; url?: string; file?: string; error?: string; createdAt?: string };
export type Snapshot = { jobs?: Job[]; downloads?: Dl[] };
/** acked: failure keys the owner dismissed. shown: failure key → first time it alerted (ms). */
export type AckState = { acked: string[]; shown: Record<string, number> };
export type FailGroup = { source: string; count: number; error: string; at: string; keys: string[]; job?: Job; download?: Dl };

export const OLD_MS = 72 * 3600_000;
export const failKey = (x: { id: string; updatedAt?: string; createdAt?: string }) => `${x.id}:${x.updatedAt ?? x.createdAt ?? ""}`;
/** A deliberate skip (non-English, policy) is not a failure. */
export const isSkip = (error?: string) => /^Skipped:/i.test(error ?? "");
const base = (s?: string) => (s ?? "").split(/[\\/]/).pop()!.toLowerCase();
const jobAt = (j: Job) => j.updatedAt ?? j.createdAt ?? "";

/** Open failures, one group per source (×count), newest first: not skipped, not dismissed, not followed by a finished job/download of the same source.
 *  A failed download whose file is also a failed job's source is the same problem and counts once. */
export function failureGroups(data: Snapshot, ack: AckState): FailGroup[] {
  const acked = new Set(ack.acked), groups = new Map<string, FailGroup>();
  const jobs = data.jobs ?? [], dls = data.downloads ?? [];
  const doneAt = (src: string) => [...jobs.filter((j) => j.status === "done" && base(j.source) === src).map(jobAt),
    ...dls.filter((d) => d.status === "done" && (base(d.file) === src || base(d.url) === src)).map((d) => d.createdAt ?? "")];
  const add = (src: string, key: string, at: string, error: string, item: { job?: Job; download?: Dl }) => {
    if (acked.has(key) || isSkip(error) || doneAt(src).some((t) => t > at)) return;
    const g = groups.get(src);
    if (!g) return void groups.set(src, { source: src, count: 1, error, at, keys: [key], ...item });
    g.count++; g.keys.push(key);
    if (at > g.at) Object.assign(g, { at, error, ...item });
  };
  for (const j of jobs) if (j.status === "failed") add(base(j.source) || j.id, failKey(j), jobAt(j), j.error ?? "", { job: j });
  for (const d of dls) if (d.status === "failed") {
    const src = groups.has(base(d.file)) ? base(d.file) : base(d.file) || base(d.url) || d.id;
    add(src, failKey(d), d.createdAt ?? "", d.error ?? "", groups.get(src)?.job ? {} : { download: d });
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Groups that still alert: an old one (> 72 h) stops once it has been shown. Returns the shown map updated with what alerts now. */
export function alertingGroups(data: Snapshot, ack: AckState, now: number): { groups: FailGroup[]; shown: Record<string, number> } {
  const open = failureGroups(data, ack);
  const shown = Object.fromEntries(open.flatMap((g) => g.keys.filter((k) => k in ack.shown).map((k) => [k, ack.shown[k]]))); // forget resolved ones
  const groups = open.filter((g) => !(now - Date.parse(g.at) > OLD_MS && g.keys.every((k) => k in shown)));
  for (const g of groups) for (const k of g.keys) shown[k] ??= now;
  return { groups, shown };
}

/** The snapshot clipProblemNotices should see: one failed record per alerting group (its count is the group count). */
export const alertSnapshot = <T extends Snapshot>(data: T, groups: FailGroup[]): T => ({ ...data,
  jobs: [...(data.jobs ?? []).filter((j) => j.status !== "failed"), ...groups.flatMap((g) => (g.job ? [g.job] : []))],
  downloads: [...(data.downloads ?? []).filter((d) => d.status !== "failed"), ...groups.flatMap((g) => (!g.job && g.download ? [g.download] : []))] });

export const ACK_KEY = "orbit.studioFailAck";
export const ACK_EVENT = "orbit:studio-fail-ack";
export function parseAck(raw: string | null): AckState {
  try { const v = JSON.parse(raw ?? ""); if (v && Array.isArray(v.acked) && v.shown && typeof v.shown === "object") return { acked: v.acked.slice(-500), shown: v.shown }; } catch { /* fresh */ }
  return { acked: [], shown: {} };
}
