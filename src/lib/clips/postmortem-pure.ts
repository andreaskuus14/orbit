// Retention post-mortem (pure, tested in tests/postmortem.test.ts): 48 h after a Short goes live, its audience-retention curve
// (analyzeRetention in retention-pure.ts) becomes one STUDIO line + ONE proposed rule. A rule reaches the Study playbook only on the
// owner's click (decideRule); nothing here ever removes or rewrites an accepted rule.
import type { RetentionReport, RetentionTranscript } from "../retention-pure.ts";
import type { Word } from "./pure.ts";

export const PM_AGE_MS = 48 * 3_600_000;
export const PM_GIVE_UP_MS = 7 * 86_400_000; // Analytics lags 1-3 days; after a week without a curve, stop asking
export const PM_RETRY_MS = 6 * 3_600_000;
export const PM_PER_RUN = 3;
const RULES_MAX = 20;

export type PmDrop = { start: number; end: number; lostPct: number | null; label: string };
export type PostMortem = { videoId: string; title: string; at: string; durationSec: number; hold3s: number | null; hold30s: number | null;
  drops: PmDrop[]; rule: string | null; ruleStatus: "proposed" | "accepted" | "dismissed" | null };
export type PostMortemView = Omit<PostMortemState, "items"> & { items: (PostMortem & { line: string })[] };
export type PmRule = { text: string; videoId: string; at: string };
export type PostMortemState = { v: 1; checkedAt?: string; status: string; tries: Record<string, { n: number; at: string }>; items: PostMortem[]; rules: PmRule[] };
export type PmRec = { videoId: string; title: string; publishedAt?: string; durationSec: number };

export const emptyPostmortem = (): PostMortemState => ({ v: 1, status: "", tries: {}, items: [], rules: [] });
export function postmortemProblem(x: unknown): string {
  const s = x as PostMortemState;
  return s?.v === 1 && typeof s.status === "string" && s.tries && typeof s.tries === "object" && Array.isArray(s.items) && Array.isArray(s.rules) ? "" : "not a post-mortem state";
}

/** Published ≥ 48 h and < 7 days ago, no post-mortem yet, not tried in the last 6 h; oldest first, a few per run. */
export function postmortemDue(recs: PmRec[], s: PostMortemState, now: number): PmRec[] {
  const done = new Set(s.items.map((i) => i.videoId));
  return recs.filter((r) => {
    const age = now - Date.parse(r.publishedAt ?? ""), t = s.tries[r.videoId];
    return age >= PM_AGE_MS && age < PM_GIVE_UP_MS && !done.has(r.videoId) && r.durationSec > 0 && !(t && now - Date.parse(t.at) < PM_RETRY_MS);
  }).sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "")).slice(0, PM_PER_RUN);
}

/** The clip's words as ~3 s transcript segments on the Short's own clock (clip start = 0). */
export function clipTranscript(words: Word[], start: number, end: number, segSec = 3): RetentionTranscript[] {
  // shortcut: source-time offset ignores jump cuts inside the edit, so labels can be off by the cut length; map through the edit list if that matters.
  const out: RetentionTranscript[] = [];
  for (const w of words) {
    if (w.start < start || w.end > end || !w.text.trim()) continue;
    const a = w.start - start, b = w.end - start, last = out.at(-1);
    if (last && a - last.start < segSec) { last.end = b; last.text += ` ${w.text.trim()}`; } else out.push({ start: a, end: Math.max(b, a + 0.01), text: w.text.trim() });
  }
  return out;
}

/** YouTube Analytics rows (elapsedVideoTimeRatio, audienceWatchRatio) → curve points; malformed rows dropped. */
export const retentionPoints = (rows: Record<string, unknown>[]) => rows.map((r) => ({ t: Number(r.elapsedVideoTimeRatio), retained: Number(r.audienceWatchRatio) }))
  .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.retained));

const quote = (s: string, n = 50) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** null = not enough curve yet (try later). The rule is proposed only when the curve shows a real drop. */
export function buildPostMortem(rec: PmRec, r: RetentionReport, at: string): PostMortem | null {
  if (r.samples < 3) return null;
  const drops = r.drops.map((d) => ({ start: Math.round(d.start * 10) / 10, end: Math.round(d.end * 10) / 10, lostPct: d.lostPct === null ? null : Math.round(d.lostPct),
    label: d.transcript ? `"${quote(d.transcript.text)}"` : d.beat ? d.beat.label : "" }));
  return { videoId: rec.videoId, title: rec.title, at, durationSec: rec.durationSec, hold3s: r.hookHold.at3s, hold30s: r.hookHold.at30s, drops,
    rule: drops.length ? r.rule : null, ruleStatus: drops.length ? "proposed" : null };
}

const sec = (n: number) => `${Math.round(n)} s`;
/** One line for the video's entry in STUDIO. */
export function pmLine(p: PostMortem): string {
  const hook = p.hold3s === null ? "" : `hook held ${Math.round(p.hold3s * 100)}% at 3 s`;
  const d = p.drops[0];
  const drop = d ? `biggest drop ${sec(d.start)}–${sec(d.end)}${d.lostPct !== null ? ` (−${d.lostPct}%)` : ""}${d.label ? ` at ${d.label}` : ""}` : "no sharp drop";
  return [hook, drop].filter(Boolean).join(" · ");
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "");
/** The owner's click. Accept appends the rule (once); dismiss only hides the proposal. Existing rules are never touched. */
export function decideRule(s: PostMortemState, videoId: string, action: "accept" | "dismiss", at: string): PostMortemState | null {
  const p = s.items.find((i) => i.videoId === videoId);
  if (!p || p.ruleStatus !== "proposed" || !p.rule) return null;
  const items = s.items.map((i) => i === p ? { ...i, ruleStatus: action === "accept" ? "accepted" as const : "dismissed" as const } : i);
  const dup = s.rules.some((r) => norm(r.text) === norm(p.rule!));
  const rules = action === "accept" && !dup && s.rules.length < RULES_MAX ? [...s.rules, { text: p.rule, videoId, at }] : s.rules;
  return { ...s, items, rules };
}

/** Accepted rules as one block for the clip-picking prompt ("" without any). */
export const rulesText = (s: PostMortemState | null) => s?.rules.length ? `His own rules from retention post-mortems: ${s.rules.map((r) => r.text).join(" ")}` : "";

/** Short morning-card line ("" when nothing new). */
export function pmMorning(s: PostMortemState | null): string {
  const waiting = s?.items.filter((i) => i.ruleStatus === "proposed").length ?? 0;
  return waiting ? `${waiting} post-mortem rule${waiting > 1 ? "s" : ""} to review.` : "";
}

/** New post-mortems first; keep the file small. */
export const addPostmortems = (s: PostMortemState, add: PostMortem[]): PostMortem[] => [...add, ...s.items.filter((i) => !add.some((a) => a.videoId === i.videoId))].slice(0, 100);
