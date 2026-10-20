// Shared judgment for Herald, desktop notifications, speech and bell batching. No I/O.
import type { NotifyDetail } from "./notify-pure.ts";
import type { NavTarget } from "./nav-pure.ts";

export const INTERRUPTION_KEY = "orbit.interruptions.v1";
export const INTERRUPTION_CHANGED = "orbit:interruptions-changed";
export const RESOLVE_ALERT = "orbit:resolve-alert";
export const CORE_BUSY = "orbit:core-busy";
export const POPUP_SHOWN = "orbit:popup-shown";
export const GAP_MS = 120_000, IDLE_MS = 20_000, WEEK_MS = 7 * 86_400_000;
export type Level = "URGENT" | "USEFUL" | "QUIET";
export const SIGNALS = ["upload-failed", "youtube-expired", "disk-full", "usage-limit", "business-reply", "stop-all", "short-hot", "agent-finished", "briefing", "reminder", "scout", "routine"] as const;
export type Signal = typeof SIGNALS[number];
export const LABELS: Record<Signal, string> = {
  "upload-failed": "Failed uploads / clip jobs", "youtube-expired": "YouTube sign-in", "disk-full": "Disk space",
  "usage-limit": "Claude usage limit", "business-reply": "Business replies", "stop-all": "Stop-all",
  "short-hot": "Short performance", "agent-finished": "Agent results", briefing: "Briefings", reminder: "Reminders", scout: "Scout picks", routine: "Routine updates",
};
const URGENT: Signal[] = ["upload-failed", "youtube-expired", "disk-full", "usage-limit", "business-reply", "stop-all"];
export type JudgmentState = { dismissals: Partial<Record<Signal, number[]>>; muted: Signal[]; lastPopup: number | null; seen: Record<string, number> };
export const emptyJudgment = (): JudgmentState => ({ dismissals: {}, muted: [], lastPopup: null, seen: {} });
const signalOK = (s: unknown): s is Signal => SIGNALS.includes(s as Signal);
const dateOK = (t: unknown, now: number): t is number => typeof t === "number" && Number.isFinite(t) && t <= now && now - t < WEEK_MS;
export function parseJudgment(raw: string | null, now: number): JudgmentState {
  let x; try { x = JSON.parse(raw ?? "null"); } catch { return emptyJudgment(); }
  if (!x || typeof x !== "object") return emptyJudgment();
  const dismissals: JudgmentState["dismissals"] = {};
  for (const s of SIGNALS) if (Array.isArray(x.dismissals?.[s])) dismissals[s] = x.dismissals[s].filter((t: unknown) => dateOK(t, now)).slice(-2);
  return { dismissals, muted: Array.isArray(x.muted) ? [...new Set<Signal>(x.muted.filter(signalOK))] : [],
    lastPopup: typeof x.lastPopup === "number" && Number.isFinite(x.lastPopup) && x.lastPopup <= now ? x.lastPopup : null,
    seen: Object.fromEntries(Object.entries(x.seen ?? {}).filter(([, t]) => dateOK(t, now))) as Record<string, number> };
}

/** Explicit producer signals win. Legacy title matching never reads untrusted bodies as control instructions. */
export function signalFor(d: NotifyDetail): Signal {
  if (signalOK(d.signal)) return d.signal;
  const t = d.title;
  if (/^(?:A clip job failed|\d+ clip jobs failed|Upload failed|Couldn't start the clip)/i.test(t)) return "upload-failed";
  if (/^YouTube (?:sign-in|login).*(?:expired|reconnect)/i.test(t)) return "youtube-expired";
  if (/^Claude usage limit (?:hit|reached)/i.test(t)) return "usage-limit";
  if (d.kind === "agents") return "agent-finished";
  if (d.kind === "life") return "reminder";
  return "routine";
}
export function classify(d: NotifyDetail, state: JudgmentState): Level {
  const s = signalFor(d);
  if (state.muted.includes(s) || d.alreadyShown) return "QUIET";
  return URGENT.includes(s) ? "URGENT" : ["short-hot", "agent-finished", "briefing", "reminder"].includes(s) ? "USEFUL" : "QUIET";
}
export const isProblem = (d: NotifyDetail) => URGENT.includes(signalFor(d));
/** Old bell entries may predate navigation metadata; their red chip must still lead somewhere useful. */
export function fixTarget(d: NotifyDetail): NavTarget {
  if (d.nav) return d.nav;
  const s = signalFor(d);
  if (s === "usage-limit") return { panel: "analytics" };
  if (s === "business-reply") return { panel: "business" };
  if (s === "upload-failed" || s === "disk-full" || s === "youtube-expired") return { panel: "studio", view: "clips" };
  return { panel: null };
}
export const reasonLine = (d: NotifyDetail) => (d.reason || d.body || d.title).replace(/\s+/g, " ").trim().slice(0, 180);
export function dismissKind(state: JudgmentState, signal: Signal, now: number): JudgmentState {
  const times = [...(state.dismissals[signal] ?? []).filter((t) => dateOK(t, now)), now].slice(-2);
  return { ...state, dismissals: { ...state.dismissals, [signal]: times }, muted: times.length >= 2 ? [...new Set([...state.muted, signal])] : state.muted };
}
export const unmuteKind = (s: JudgmentState, signal: Signal): JudgmentState => ({ ...s, muted: s.muted.filter((k) => k !== signal), dismissals: { ...s.dismissals, [signal]: [] } });
export type Attention = { visible: boolean; coreBusy: boolean; worldOpen: boolean; lastTyped: number; popupsOff?: boolean };
export const ownerIdle = (a: Attention, now: number) => a.visible && !a.coreBusy && !a.worldOpen && now - a.lastTyped >= IDLE_MS;
/** Every input is already in the bell. Quiet/rate-limited extras stay there; useful items wait while busy.
 * Urgent bypasses idle/rate/room, but respects explicit mute. No popup eviction can lose a bell item. */
export function selectInterruptions<T extends NotifyDetail>(state: JudgmentState, pending: T[], now: number, a: Attention, room = 1): { state: JudgmentState; show: T[]; pending: T[]; batched: T[] } {
  const show: T[] = [], wait: T[] = [], batched: T[] = [];
  let lastPopup = state.lastPopup;
  for (const d of [...pending.filter((d) => classify(d, state) === "URGENT"), ...pending.filter((d) => classify(d, state) !== "URGENT")]) {
    const level = classify(d, state);
    if (level === "QUIET" || a.popupsOff) { batched.push(d); continue; }
    if (level === "URGENT") { show.push(d); lastPopup = now; continue; }
    if (!ownerIdle(a, now)) { wait.push(d); continue; }
    if (room <= 0 || (lastPopup !== null && now - lastPopup < GAP_MS)) { batched.push(d); continue; }
    show.push(d); room--; lastPopup = now;
  }
  return { state: { ...state, lastPopup }, show, pending: wait, batched };
}
export const batchCount = (items: (NotifyDetail & { read: boolean; interrupted?: boolean })[], state: JudgmentState) => items.filter((x) => !x.read && !x.interrupted && classify(x, state) !== "URGENT").length;

/** Read-only observations: no AI, no work started. First business snapshot is a baseline, not a flood. */
export function businessReplies(previous: Record<string, string> | null, rows: { id: string; name: string; stage: string; updated_at: string }[]): { stages: Record<string, string>; notices: NotifyDetail[] } {
  return { stages: Object.fromEntries(rows.map((p) => [p.id, p.stage])), notices: previous === null ? [] : rows.filter((p) => p.stage === "replied" && previous[p.id] !== "replied").map((p) => ({
    key: `business:${p.id}:${p.updated_at}`, kind: "system", signal: "business-reply", title: "A business replied", reason: `${p.name.slice(0, 80)} moved to Replied in your pipeline.`, nav: { panel: "business" },
  })) };
}

type ClipSnapshot = { jobs?: { id: string; status: string; source?: string; updatedAt?: string; clips?: { id: string; title?: string; publish?: { status: string; at?: string } }[] }[];
  downloads?: { id: string; status: string; url?: string; createdAt?: string }[] };
/** Each failure has its own stable key: a second failed upload must not disappear behind the first open problem. */
export function clipProblemNotices(data: ClipSnapshot): NotifyDetail[] {
  const out: NotifyDetail[] = [];
  const add = (key: string, title: string, reason: string, review: boolean) => out.push({ key, title, reason, kind: "studio", signal: "upload-failed", fixLabel: "Review failure", nav: { panel: "studio", view: review ? "review" : "clips" } });
  for (const j of data.jobs ?? []) {
    if (j.status === "failed") add(`failed-job:${j.id}:${j.updatedAt ?? ""}`, "A clip job failed", `Clip job ${(j.source || j.id).slice(0, 100)} failed and needs review.`, false);
    for (const c of j.clips ?? []) if (c.publish?.status === "failed") add(`failed-upload:${j.id}:${c.id}:${c.publish.at ?? ""}`, "Upload failed", `Your Short ${(c.title || c.id).slice(0, 100)} could not be uploaded.`, true);
  }
  for (const d of data.downloads ?? []) if (d.status === "failed") add(`failed-download:${d.id}:${d.createdAt ?? ""}`, "A download failed", `Download ${d.id.slice(0, 50)} failed; STUDIO has the error and retry control.`, false);
  return out;
}
