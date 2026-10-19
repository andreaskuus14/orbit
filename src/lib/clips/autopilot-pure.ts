// YouTube autopilot (pure, tested in tests/autopilot.test.ts): settings + daily caps, learned preferences shrunk toward the channel's
// usual for small samples, candidate ranking, title + slot proposals, and pipeline stages. The orchestration is autopilot.ts.
import { creatorOf, hookStyle, kindOf, lengthBand, scoreClips, type LearnRec } from "./learn-pure.ts";
import { isClipId, isJobId, validOptions } from "./pure.ts";
import { MIN_LEAD_MS, nextSlots, wall, type PublishSettings } from "./schedule.ts";
import { localDay, videoIdOf, type ScoutPick } from "./scout-pure.ts";
import type { ClipJob, ClipOptions, Download } from "./types";

export const PROPOSE_LEAD_MS = 20 * 60_000; // a proposed slot is at least this far ahead
export const MAX_DAILY = 5; // hard ceiling on autopilot downloads (= clip jobs) per local day, whatever the setting says
export const TRACKED_MAX = 200;

/** A clip-ready proposal: nothing here is applied until the owner approves. key = "<job>/<clip>". */
export type Proposal = { title: string; titleWhy: string; thumb?: string; description?: string; slot?: string; slotWhy: string; at: string;
  alts?: string[]; notes?: string[]; video?: string }; // runner-up titles (one-click swap), the title critics' notes, the clip's video (card preview)
export type Tracked = { videoId: string; title: string; channel: string; at: string; auto: boolean };
export type Autopilot = { v: 1; auto: boolean; dailyDownloads: number; options: Required<ClipOptions>;
  day: string; downloads: number; // autopilot downloads started on `day` (local)
  tracked: Tracked[]; proposals: Record<string, Proposal>;
  lastAuto?: string }; // the scout run (lastRun.at) auto mode already acted on: each run is acted on once

export const emptyAutopilot = (): Autopilot => ({ v: 1, auto: false, dailyDownloads: 2, options: validOptions({ layout: "follow" }) as Required<ClipOptions>,
  day: "", downloads: 0, tracked: [], proposals: {} });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";
export const isKey = (k: unknown): k is string => str(k) && k.split("/").length === 2 && isJobId(k.split("/")[0]) && isClipId(k.split("/")[1]);

/** A settings patch → the new state, or a message for a 400. */
export function patchAutopilot(b: Record<string, unknown>, cur: Autopilot): Autopilot | string {
  const out = { ...cur };
  if (b.auto !== undefined) { if (typeof b.auto !== "boolean") return "auto must be true or false"; out.auto = b.auto; }
  if (b.dailyDownloads !== undefined) {
    if (!Number.isInteger(b.dailyDownloads) || (b.dailyDownloads as number) < 0 || (b.dailyDownloads as number) > MAX_DAILY) return `dailyDownloads must be 0-${MAX_DAILY}`;
    out.dailyDownloads = b.dailyDownloads as number;
  }
  if (b.options !== undefined) {
    if (!isObj(b.options)) return "options must be an object";
    const o = validOptions({ ...cur.options, ...b.options });
    if (typeof o === "string") return o;
    out.options = o;
  }
  return out;
}

/** autopilot.json → state, or why it's unusable (then it's quarantined). Bad entries are dropped, not fatal. */
export function parseAutopilot(x: unknown): Autopilot | string {
  if (!isObj(x) || x.v !== 1) return "not an autopilot state";
  const base = emptyAutopilot();
  const s = patchAutopilot({ auto: x.auto, dailyDownloads: x.dailyDownloads, options: isObj(x.options) ? x.options : undefined }, base);
  if (typeof s === "string") return s;
  const tracked = (Array.isArray(x.tracked) ? x.tracked : []).filter((t): t is Tracked => isObj(t) && str(t.videoId) && str(t.title) && str(t.channel) && str(t.at) && typeof t.auto === "boolean").slice(-TRACKED_MAX);
  const proposals = Object.fromEntries(Object.entries(isObj(x.proposals) ? x.proposals : {}).filter(([k, p]) => isKey(k) && isObj(p) && str(p.title) && str(p.titleWhy) && str(p.slotWhy) && str(p.at)
    && (p.slot === undefined || str(p.slot)) && (p.description === undefined || str(p.description)) && (p.thumb === undefined || str(p.thumb))
    && (p.video === undefined || str(p.video)) && [p.alts, p.notes].every((l) => l === undefined || (Array.isArray(l) && l.every(str))))) as Record<string, Proposal>;
  return { ...s, day: str(x.day) ? x.day : "", downloads: Number.isInteger(x.downloads) ? Math.max(0, x.downloads as number) : 0, tracked, proposals,
    lastAuto: str(x.lastAuto) ? x.lastAuto : undefined };
}

// ---- daily caps ----

export const usedDownloads = (a: Pick<Autopilot, "day" | "downloads">, now: Date) => (a.day === localDay(now) ? Math.max(0, a.downloads) : 0);
/** The scout's own auto-clips today (scout.json auto: {day, n}); they count toward the same daily cap. */
export const scoutAutoToday = (auto: { day: string; n: number } | undefined, now: Date) => (auto && auto.day === localDay(now) ? Math.max(0, auto.n) : 0);
export const dailyCap = (a: Pick<Autopilot, "dailyDownloads">) => Math.max(0, Math.min(a.dailyDownloads, MAX_DAILY));
/** One shared cap: autopilot downloads + the scout's auto-clips today ≤ dailyDownloads (≤ MAX_DAILY). */
export const capLeft = (a: Pick<Autopilot, "day" | "downloads" | "dailyDownloads">, now: Date, scoutAuto = 0) =>
  Math.min(MAX_DAILY, Math.max(0, dailyCap(a) - usedDownloads(a, now) - Math.max(0, scoutAuto)));
export function spendDownload(a: Autopilot, now: Date) { a.downloads = usedDownloads(a, now) + 1; a.day = localDay(now); }

// ---- learned preferences ----

export type Dim = "creator" | "length" | "hook" | "title" | "layout" | "hour" | "kind";
const DIMS: Dim[] = ["creator", "length", "hook", "title", "layout", "hour", "kind"];
export type Pref = { n: number; mult: number }; // mult: shrunk multiplier on the channel's usual 72 h views (1 = usual)
export type Prefs = { at: string; n: number; dims: Partial<Record<Dim, Record<string, Pref>>> };
export const PRIOR_K = 3; // pseudo-Shorts at the channel's usual: 1 Short moves a bucket ~25% of the way, 9 Shorts ~75%

/** Mean log-performance shrunk toward 0 (= the usual) with PRIOR_K pseudo-observations, as a multiplier. Logs: one viral hit can't dominate. */
export const shrunkMult = (logs: number[], k = PRIOR_K) => Math.exp(logs.reduce((a, b) => a + b, 0) / (logs.length + k));

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40); // untrusted names → prompt-safe
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ""); // yt-dlp file names drop spaces/non-ASCII; channel titles don't

/** Published Shorts with 72 h stats → per-feature multipliers. tz: the publish time zone (posting hour). */
export function learnPrefs(recs: LearnRec[], tz: string, at: string): Prefs {
  const scored = scoreClips(recs), acc = new Map<string, { dim: Dim; label: string; logs: number[] }>();
  for (const { rec: r, score } of scored) {
    const pub = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
    const f: Record<Dim, string> = { creator: r.sourceChannel, length: lengthBand(r.durationSec), hook: hookStyle(r.hook), title: hookStyle(r.title), layout: r.layout, kind: r.kind,
      hour: Number.isFinite(pub) ? hourLabel(wall(pub, tz)[3]) : "unknown" };
    for (const d of DIMS) {
      if (!f[d] || f[d] === "unknown" || f[d] === "other") continue;
      const k = `${d}\0${f[d]}`;
      (acc.get(k) ?? acc.set(k, { dim: d, label: f[d], logs: [] }).get(k)!).logs.push(Math.log(Math.max(0.05, score))); // 0 views → 0.05×, not -∞
    }
  }
  const dims: Prefs["dims"] = {};
  for (const b of acc.values()) (dims[b.dim] ??= {})[b.label] = { n: b.logs.length, mult: Math.round(shrunkMult(b.logs) * 100) / 100 };
  return { at, n: scored.length, dims };
}

export const prefOf = (p: Prefs | undefined, dim: Dim, label: string): Pref | undefined =>
  dim === "creator" ? Object.entries(p?.dims.creator ?? {}).find(([k]) => norm(k) === norm(label))?.[1] : p?.dims[dim]?.[label];
export const multOf = (p: Prefs | undefined, dim: Dim, label: string) => prefOf(p, dim, label)?.mult ?? 1;

export function confidence(n: number): string {
  const level = n < 5 ? "weak" : n < 15 ? "moderate" : "decent";
  return `based on ${n} Short${n === 1 ? "" : "s"} — ${level} signal`;
}

const PHRASE: Record<Dim, (l: string) => string> = {
  creator: (l) => `Clips from ${l}`, length: (l) => `${l.replace("-", "–")} s clips`, hook: (l) => `Hooks as ${l === "none" ? "no text" : `a ${l}`}`,
  title: (l) => `Titles as ${l === "none" ? "no text" : `a ${l}`}`, layout: (l) => `The ${l} layout`, hour: (l) => `Posting at ${l}`, kind: (l) => `${l[0].toUpperCase()}${l.slice(1)} moments`,
};

/** Plain-English findings, strongest first: buckets ≥ 2 Shorts whose shrunk multiplier is ≥ 15% off the usual. */
export function findings(p: Prefs | undefined, max = 5): { text: string; dim: Dim; label: string; n: number; mult: number }[] {
  const out = [];
  for (const d of DIMS) for (const [label, x] of Object.entries(p?.dims[d] ?? {})) {
    if (x.n < 2 || Math.abs(Math.log(x.mult)) < Math.log(1.15)) continue;
    const how = x.mult >= 1 ? `get ${x.mult.toFixed(1)}× your usual views` : `get ${Math.round((1 - x.mult) * 100)}% fewer views than usual`;
    out.push({ text: `${PHRASE[d](clean(label))} ${how} (${x.n} Shorts)`, dim: d, label, n: x.n, mult: x.mult });
  }
  return out.sort((a, b) => Math.abs(Math.log(b.mult)) - Math.abs(Math.log(a.mult))).slice(0, max);
}

/** One line for Claude's clip-picking prompts (data, not instructions); "" with nothing to say. */
export function prefsHint(p: Prefs | undefined): string {
  const f = findings(p, 4).filter((x) => x.dim !== "hour"); // posting time doesn't change which moment to cut
  return f.length ? `Shrunk channel stats (${confidence(p!.n)}): ${f.map((x) => x.text).join("; ")}.` : "";
}

// ---- candidates ----

export type Ranked = ScoutPick & { apScore: number; why: string[] };
const hoursSince = (iso: string, now: number) => (now - Date.parse(iso)) / 3_600_000;

/** The scout's new picks re-ranked for the autopilot: its score (pace vs the creator's usual, engagement, length; or Claude's) × freshness ×
 *  the learned multipliers for the creator and the moment kind (topic) its title suggests, together clamped 0.6-1.6: winners' creators rise,
 *  repeated flops sink, but a weak signal can't bury a hot video and new creators (no data = 1×) still get tried. `done`: video ids already clipped. */
export function rankCandidates(picks: ScoutPick[], p: Prefs | undefined, now: number, done: Set<string>, vir?: Map<string, { avg: number; n: number }>): Ranked[] {
  return picks.filter((x) => x.status === "new" && !done.has(x.videoId)).map((x) => {
    const age = hoursSince(x.publishedAt, now), fresh = age <= 24 ? 1 : age <= 72 ? 0.9 : 0.75; // clip while it's hot
    const kind = kindOf(`${x.title} ${x.reason}`), kp = kind === "other" ? undefined : prefOf(p, "kind", kind);
    const cp = prefOf(p, "creator", x.channel), cm = Math.min(1.6, Math.max(0.6, (cp?.mult ?? 1) * (kp?.mult ?? 1)));
    const why = [x.reason, `${Math.round(Math.max(0, age))} h old${fresh < 1 ? ` (×${fresh} freshness)` : ""}`, `${Math.round(x.durationSec / 60)} min long`];
    if (cp) why.push(`your clips from ${x.channel}: ${cp.mult.toFixed(2)}× usual views (${cp.n} Shorts)`);
    if (kp) why.push(`your ${kind} clips: ${kp.mult.toFixed(2)}× usual views (${kp.n} Shorts)`);
    // Blend, not replace: the creator's average virality score of clips ORBIT already made nudges ±15%.
    const v = vir?.get(norm(x.channel)), vm = v && v.n >= 2 ? 0.85 + 0.3 * Math.min(1, Math.max(0, v.avg / 100)) : 1;
    if (v && vm !== 1) why.push(`clips made from ${x.channel} score ${Math.round(v.avg)}/100 on average (${v.n} clips)`);
    return { ...x, apScore: Math.round(Math.min(100, x.score * fresh * cm * vm)), why };
  }).sort((a, b) => b.apScore - a.apScore);
}

/** Average virality score per creator (normalized name) over clips that have one. */
export function creatorVirality(jobs: ClipJob[]): Map<string, { avg: number; n: number }> {
  const m = new Map<string, { avg: number; n: number }>();
  for (const j of jobs) for (const c of j.clips) {
    if (!c.virality || c.variantOf) continue;
    const k = norm(creatorOf(j.source)), e = m.get(k) ?? { avg: 0, n: 0 };
    m.set(k, { avg: (e.avg * e.n + c.virality.score) / (e.n + 1), n: e.n + 1 });
  }
  return m;
}

// ---- packaging ----

/** Best title option: Claude's click score × the learned multiplier for that title style. */
/** src: what the scores are (the critics' re-scores when they ran). */
export function pickTitle(opts: { text: string; score: number }[] | undefined, current: string, p?: Prefs, src = "Claude's click guess"): { title: string; why: string } {
  const all = opts?.length ? opts : [{ text: current, score: 50 }];
  const val = (o: { text: string; score: number }) => o.score * multOf(p, "title", hookStyle(o.text));
  const best = all.reduce((a, b) => (val(b) > val(a) ? b : a));
  const st = hookStyle(best.text), m = prefOf(p, "title", st);
  return { title: best.text, why: m && m.mult !== 1 ? `${src} ${best.score}/100 × ${m.mult.toFixed(2)} for ${st} titles on your channel (${m.n} Shorts)` : `${src}: the top one (${best.score}/100)` };
}

/** The owner's edit of a waiting proposal: swap in another title (the old one becomes a runner-up) and/or pick a free slot. A message for a 400. */
export function editProposal(p: Proposal, b: Record<string, unknown>, free: string[]): Proposal | string {
  const out = { ...p };
  if (b.title !== undefined) {
    const t = str(b.title) ? b.title.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim() : "";
    if (!t || t.length > 100) return "title must be 1-100 characters";
    if (t !== p.title) Object.assign(out, { title: t, titleWhy: "You picked this title", alts: [p.title, ...(p.alts ?? []).filter((x) => x !== t)].slice(0, 2) });
  }
  if (b.slot !== undefined) {
    if (!str(b.slot) || !free.includes(b.slot)) return "That slot isn't free any more; pick another";
    if (b.slot !== p.slot) Object.assign(out, { slot: b.slot, slotWhy: "You picked this slot" });
  }
  return out;
}

/** A publish slot from the free calendar slots: the earliest, unless one of the next 3 is at an hour that clearly (>10%) does better.
 *  taken: slots already proposed to other clips (they count as used, so proposals never collide). */
export function proposeSlot(s: PublishSettings, used: number[], taken: string[], now: number, p?: Prefs): { slot?: string; why: string } {
  // nextSlots keeps MIN_LEAD_MS + 1 min ahead; shifting `now` makes that PROPOSE_LEAD_MS, so there's time to approve before the slot is too close
  const free = nextSlots(s, [...used, ...taken.map(Date.parse).filter(Number.isFinite)], now + PROPOSE_LEAD_MS - MIN_LEAD_MS - 60_000, 3);
  if (!free.length) return { why: "No free slot in the next 6 months — edit your publish slots" };
  const hour = (iso: string) => hourLabel(wall(Date.parse(iso), s.timezone)[3]);
  const best = free.reduce((a, b) => (multOf(p, "hour", hour(b)) > multOf(p, "hour", hour(a)) * 1.1 ? b : a));
  const m = prefOf(p, "hour", hour(best)), first = prefOf(p, "hour", hour(free[0]));
  const why = best === free[0] ? "Next free slot in your calendar"
    : m ? `Posting at ${hour(best)} gets ${m.mult.toFixed(1)}× your usual views (${m.n} Shorts)`
    : `Skips ${hour(free[0])}, which gets ${first ? `${first.mult.toFixed(1)}× your usual views (${first.n} Shorts)` : "fewer views"}`;
  return { slot: best, why };
}

// ---- pipeline ----

export type Stage = "found" | "clipping" | "packaging" | "waiting" | "scheduled" | "published" | "failed";
export const STAGES: Stage[] = ["found", "clipping", "packaging", "waiting", "scheduled", "published"];
export type PipeClip = { key: string; title: string; stage: Stage; thumb?: string; scheduledFor?: string; videoId?: string };
export type PipeItem = Tracked & { stage: Stage; detail: string; clips: PipeClip[] };

/** Where each autopilot video is: download → clip job → its clips (packaging → waiting for you → scheduled → published). */
export function pipeline(tracked: Tracked[], downloads: Download[], jobs: ClipJob[], proposals: Record<string, Proposal>, now: number): PipeItem[] {
  return tracked.map((t): PipeItem => {
    const d = downloads.filter((x) => videoIdOf(x.url) === t.videoId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const at = (stage: Stage, detail: string, clips: PipeClip[] = []) => ({ ...t, stage, detail, clips });
    if (!d) return at("failed", "The download was removed");
    if (d.status === "failed") return at("failed", d.error ?? "Download failed");
    if (d.status !== "done") return at("clipping", d.step || "Downloading");
    const job = jobs.find((j) => j.source === d.file);
    if (!job) return at("clipping", "Starting the clip job");
    if (job.status === "failed") return at("failed", job.error ?? "Clip job failed");
    if (job.status !== "done") return at("clipping", job.step || "Making clips");
    const clips = job.clips.flatMap((c): PipeClip[] => {
      const key = `${job.id}/${c.id}`, p = c.publish, base = { key, title: c.title, thumb: c.thumb, videoId: p?.videoId, scheduledFor: p?.scheduledFor };
      if (c.status === "rejected" || c.status === "failed" || c.status === "rendering") return [];
      if (p?.status === "done" || (p?.status === "scheduled" && Date.parse(p.scheduledFor ?? "") <= now)) return [{ ...base, stage: "published" }];
      if (p?.status === "scheduled" || p?.status === "uploading") return [{ ...base, stage: "scheduled" }];
      if (c.status === "approved") return [{ ...base, stage: p?.status === "failed" || p?.status === "unknown" ? "failed" : "waiting" }];
      return [{ ...base, stage: proposals[key] ? "waiting" : "packaging" }];
    });
    if (!clips.length) return at("failed", "No clips kept from this video", []);
    const stage = STAGES.find((s) => clips.some((c) => c.stage === s)) ?? "failed"; // the least advanced clip
    return at(stage, `${clips.length} clip${clips.length === 1 ? "" : "s"}`, clips);
  });
}

/** Clips per stage (videos while they are still downloading / clipping), plus the new candidates as "found". */
export function stageCounts(items: PipeItem[], found: number): Record<Stage, number> {
  const out = Object.fromEntries([...STAGES, "failed"].map((s) => [s, 0])) as Record<Stage, number>;
  out.found = found;
  for (const i of items) if (i.clips.length) for (const c of i.clips) out[c.stage]++; else out[i.stage]++;
  return out;
}
