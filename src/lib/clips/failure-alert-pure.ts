// Which STUDIO failures still deserve an alert, grouped per source. Pure; used by StudioNotifier (alerts) and ClipFactory (Failed view).
// Dismissals live server-side (studio-fail-ack.json via /api/studio/clips), so every browser and the phone agree.
import { videoIdFrom } from "../ideas-pure.ts";
type Job = { id: string; status: string; source?: string; error?: string; createdAt?: string; updatedAt?: string };
type Dl = { id: string; status: string; url?: string; file?: string; error?: string; createdAt?: string };
export type Snapshot = { jobs?: Job[]; downloads?: Dl[] };
export type FailGroup = { source: string; count: number; error: string; at: string; keys: string[]; job?: Job; download?: Dl };

export const OLD_MS = 72 * 3600_000;
export const failKey = (x: { id: string; updatedAt?: string; createdAt?: string }) => `${x.id}:${x.updatedAt ?? x.createdAt ?? ""}`;
/** A deliberate skip (non-English, policy) is not a failure. */
export const isSkip = (error?: string) => /^Skipped:/i.test(error ?? "");
const base = (s?: string) => (s ?? "").split(/[\\/]/).pop()!.toLowerCase();
const jobAt = (j: Job) => j.updatedAt ?? j.createdAt ?? "";
/** A download's video: the YouTube id when there is one (youtu.be/x and watch?v=x are the same video), else the link's last segment. */
const vid = (url?: string) => (url && videoIdFrom(url)) || base(url);

/** Open failures, one group per source (×count), newest first: not skipped, not dismissed, not followed by a finished job/download of the same source.
 *  A failed download whose file is also a failed job's source is the same problem and counts once. since: ISO time; older failures are left out. */
export function failureGroups(data: Snapshot, acked: string[] = [], since = ""): FailGroup[] {
  const ack = new Set(acked), groups = new Map<string, FailGroup>();
  const jobs = data.jobs ?? [], dls = data.downloads ?? [];
  // A finished download of the video also counts as its job's source, so a failed download is resolved by a later done download/job of it.
  const doneAt = (src: string) => [...jobs.filter((j) => j.status === "done" && base(j.source) === src).map(jobAt),
    ...dls.filter((d) => d.status === "done" && (base(d.file) === src || vid(d.url) === src)).map((d) => d.createdAt ?? "")];
  const add = (src: string, key: string, at: string, error: string, item: { job?: Job; download?: Dl }) => {
    if (at < since || ack.has(key) || isSkip(error) || doneAt(src).some((t) => t > at)) return;
    const g = groups.get(src);
    if (!g) return void groups.set(src, { source: src, count: 1, error, at, keys: [key], ...item });
    g.count++; g.keys.push(key);
    if (at > g.at) Object.assign(g, { at, error, ...item });
  };
  for (const j of jobs) if (j.status === "failed") add(base(j.source) || j.id, failKey(j), jobAt(j), j.error ?? "", { job: j });
  for (const d of dls) if (d.status === "failed") {
    const src = groups.has(base(d.file)) ? base(d.file) : base(d.file) || vid(d.url) || d.id;
    add(src, failKey(d), d.createdAt ?? "", d.error ?? "", groups.get(src)?.job ? {} : { download: d });
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Groups that still alert: open failures from the last 72 h. Older ones stay in STUDIO's Failed list but never alert, in any browser. */
export const alertingGroups = (data: Snapshot, acked: string[], now: number) => failureGroups(data, acked, new Date(now - OLD_MS).toISOString());

/** The snapshot clipProblemNotices should see: one failed record per alerting group (its count is the group count). */
export const alertSnapshot = <T extends Snapshot>(data: T, groups: FailGroup[]): T => ({ ...data,
  jobs: [...(data.jobs ?? []).filter((j) => j.status !== "failed"), ...groups.flatMap((g) => (g.job ? [g.job] : []))],
  downloads: [...(data.downloads ?? []).filter((d) => d.status !== "failed"), ...groups.flatMap((g) => (!g.job && g.download ? [g.download] : []))] });

/** Legacy per-browser dismissals (before they moved server-side): read once by ClipFactory, sent to the server, then removed. */
export const ACK_KEY = "orbit.studioFailAck";
export const ACK_EVENT = "orbit:studio-fail-ack";
export function legacyAcked(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? ""); if (Array.isArray(v?.acked)) return v.acked.filter((k: unknown) => typeof k === "string").slice(-500); } catch { /* none */ }
  return [];
}
