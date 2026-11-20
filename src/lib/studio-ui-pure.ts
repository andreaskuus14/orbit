// STUDIO layout rules (UI audit PR 2/3, 20 Nov): which sections and tabs show in the row and which sit behind "More", the one
// review queue every "review / approve" entry point opens, and the one-line answer to "what is ORBIT doing by itself?".
// Pure; tested in tests/studio-ui.test.ts. UI: StudioWorld.tsx, ClipFactory.tsx, ReviewQueue.tsx, StudioAuto.tsx.

/* ---------- tabs ---------- */

export type StudioMode = "channel" | "stats" | "clips" | "production" | "sites" | "other";
/** Channel · Shorts · Stats, then More ▾ (Production details, Websites, More drafts). Ids are unchanged, so links and CORE keep working. */
export const STUDIO_MODES: readonly { id: StudioMode; label: string; secondary?: boolean }[] = [
  { id: "channel", label: "st.mode.channel" }, { id: "clips", label: "st.mode.shorts" }, { id: "stats", label: "st.mode.stats" },
  { id: "production", label: "st.mode.production", secondary: true }, { id: "sites", label: "st.mode.sites", secondary: true }, { id: "other", label: "st.mode.other", secondary: true },
];

export type ClipTab = "pipeline" | "find" | "clips" | "story" | "longform" | "calendar" | "insights" | "autopilot";
/** Find · Review · Scheduled, then More ▾. "clips" is the Review tab and "calendar" the Scheduled tab (ids kept: saved tabs still open). */
export const CLIP_TABS: readonly { id: ClipTab; secondary?: boolean }[] = [
  { id: "find" }, { id: "clips" }, { id: "calendar" },
  { id: "autopilot", secondary: true }, { id: "pipeline", secondary: true }, { id: "story", secondary: true }, { id: "longform", secondary: true }, { id: "insights", secondary: true },
];
export const parseClipTab = (v: unknown): ClipTab | null => (CLIP_TABS.some((t) => t.id === v) ? (v as ClipTab) : null);

/** Produce → views behind More: Ideas repeats All steps, Calendar repeats Scheduled; the tools after them are rarely needed. */
export const PROD_SECONDARY: ReadonlySet<string> = new Set(["ideas", "calendar", "voice", "captions", "projects", "track"]);

/* ---------- the one review queue ---------- */

type QClip = { id: string; status: string; score: number; virality?: { score: number } };
type QJob = { id: string; createdAt: string; clips: readonly QClip[] };
const pct = (s: number) => Math.round(Number.isFinite(s) ? (s <= 1 ? s * 100 : s) : 0); // same scale rule as ClipFactory
/** Mirrors rankScore in clips/score-pure.ts: the virality score when there is one, else the editor's score. */
export const rank = (c: QClip) => c.virality?.score ?? pct(c.score);

/** Everything waiting for his decision, in one list: clips ready for review, plus approved clips the autopilot is still
 *  waiting on (keys "job/clip", its "Waiting for you"). Most likely to do well first; newest job first among equals. */
export function reviewQueue<J extends QJob>(jobs: readonly J[], waiting: ReadonlySet<string> = new Set()): { job: J; clip: J["clips"][number] }[] {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .flatMap((j) => j.clips.filter((c) => c.status === "ready" || (c.status === "approved" && waiting.has(`${j.id}/${c.id}`))).map((clip) => ({ job: j, clip })))
    .sort((a, b) => rank(b.clip) - rank(a.clip));
}
/** Where the queue opens: on the asked clip when it is in the list, else at the start. */
export const startAt = (items: readonly { job: { id: string }; clip: { id: string } }[], key?: string) =>
  Math.max(0, key ? items.findIndex((x) => `${x.job.id}/${x.clip.id}` === key) : 0);

/* ---------- what ORBIT does by itself ---------- */

/** null = not loaded (or that settings file couldn't be read). */
export type AutoState = {
  autopilot: boolean | null; perDay: number | null; inbox: boolean | null; niche: boolean | null; devlog: boolean | null;
  creators: { auto: number; total: number } | null; publish: "off" | "ask" | "do" | "auto" | null; publishPerDay: number | null;
};
export const NO_AUTO: AutoState = { autopilot: null, perDay: null, inbox: null, niche: null, devlog: null, creators: null, publish: null, publishPerDay: null };
export type Phrase = { key: string; vars?: Record<string, string | number> };

/** The status line at the top of Shorts, e.g. "Autopilot: on · clips 2 creators · posts nothing without you". */
export function autoLine(s: AutoState): Phrase[] {
  const out: Phrase[] = [];
  if (s.autopilot !== null) out.push({ key: s.autopilot ? "sa.line.on" : "sa.line.off" });
  if (s.creators?.auto) out.push({ key: "sa.line.creators", vars: { n: s.creators.auto } });
  if (s.inbox) out.push({ key: "sa.line.inbox" });
  if (s.devlog) out.push({ key: "sa.line.devlog" });
  if (s.niche) out.push({ key: "sa.line.niche" });
  if (s.publish === "auto") out.push({ key: "sa.line.posts", vars: { n: s.publishPerDay ?? 1 } });
  else if (s.publish !== null) out.push({ key: "sa.line.postsNone" });
  return out;
}
/** How many things run by themselves (0 = ORBIT only acts when he asks). Posting counts only when it is Auto. */
export const autoCount = (s: AutoState) =>
  [s.autopilot, s.inbox, s.niche, s.devlog, (s.creators?.auto ?? 0) > 0, s.publish === "auto"].filter((x) => x === true).length;
