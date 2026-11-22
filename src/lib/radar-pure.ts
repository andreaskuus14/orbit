// OPPORTUNITY RADAR (pure, tested in tests/radar.test.ts): reads the signals ORBIT already collects (YouTube Gaming chart risers,
// weekly outlier ideas, Roblox Trend Radar risers, REACH (Reddit and co.), news articles, new BUSINESS leads) and opens a "window"
// only when something time-limited fits one of his projects: several signals about the same thing in 48 h, more than the 48 h
// before. Each window has a reason, evidence links, and one suggested next step (a draft task inside ORBIT, started only by his
// click). Pings are capped per day and per topic, and wait out quiet hours and Stop-all. IO: radar.ts; UI: RadarCards.tsx.
import type { Lang } from "./i18n-pure.ts";
import type { Progress } from "./progress-pure.ts";

export type RadarSource = "youtube" | "outlier" | "roblox" | "reach" | "news" | "business";
export type RadarArea = "studio" | "gamedev" | "business";
export type Signal = { source: RadarSource; key: string; title: string; at: number; url?: string; strong?: boolean; area?: RadarArea; kind?: string };
/** One thing he works on: an area and the words that mean it (scout keywords, project and goal names). */
export type Project = { area: RadarArea; name: string; terms: string[] };
export type Evidence = { title: string; url?: string; source: RadarSource };
export type Step = { label: string; agent: string; title: string; request: string } | { label: string; open: string };
export type Window = { id: string; area: RadarArea; term: string; project: string; count: number; before: number; sources: RadarSource[]; strong: number;
  score: number; reason: string; evidence: Evidence[]; step: Step; openedAt: number; closesAt: number };

const H = 3_600_000, DAY = 24 * H;
export const WINDOW_MS = 48 * H;      // "spiking": signals in the last 48 h…
export const MIN_SIGNALS = 3;         // …at least this many (or 2 with a strong one, or 2 from different sources)…
export const PING_MAX_PER_DAY = 2;    // phone pings a Tallinn day; the radar card still lists every open window
export const TOPIC_GAP_MS = 3 * DAY;  // the same topic pings again only after this
export const SNOOZE_MS = 7 * DAY;     // "Not now" hides a topic for a week
export const MIN_SCORE = 4;
export const RADAR_TZ = "Europe/Tallinn";

// ---- words ----
const STOP = new Set(("the and for with from that this your you are was what why how new best top all get got can will not but out one day video videos " +
  "short shorts game games gaming roblox update official live stream part episode full funny epic play playing").split(" "));
export const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Does this title mention the term (whole words, a plural "s" allowed)? */
export function mentions(title: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  const re = new RegExp(`(?:^| )${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?: |$)`);
  return re.test(norm(title));
}
/** A project's own terms: each keyword phrase, plus its single meaningful words (≥ 4 letters). */
export function projectTerms(name: string, extra: string[] = []): string[] {
  const phrases = [name, ...extra].map(norm).filter(Boolean);
  const words = phrases.flatMap((p) => p.split(" ")).filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set([...phrases.filter((p) => p.split(" ").length <= 3 && p.length >= 3 && !STOP.has(p)), ...words])].slice(0, 12);
}
/** Which area a project name belongs to (Roblox/game words → GAME DEV, business words → BUSINESS, else STUDIO). */
export const areaOf = (name: string): RadarArea =>
  /\b(roblox|game|obby|tycoon|simulator|luau|studio place)\b/i.test(name) ? "gamedev" : /\b(business|lead|client|webshop|shop|pitch|sales|ettevõt)/i.test(name) ? "business" : "studio";

const FITS: Record<RadarArea, RadarSource[]> = { studio: ["youtube", "outlier", "reach", "news"], gamedev: ["roblox", "youtube", "reach", "news"], business: ["business", "news"] };

const ytUrl = (id: string) => (/^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined);
export const robloxUrl = (placeId: number) => (Number.isInteger(placeId) && placeId > 0 ? `https://www.roblox.com/games/${placeId}` : undefined);
export const youtubeUrl = ytUrl;
/** Only public http(s) links are shown as evidence. */
export const safeUrl = (u: unknown) => (typeof u === "string" && /^https:\/\/[^\s<>"']+$/.test(u) && u.length <= 500 ? u : undefined);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const SRC_WORD: Record<RadarSource, string> = { youtube: "rising video", outlier: "outlier", roblox: "rising game", reach: "hot post", news: "news story", business: "new lead" };
function why(term: string, xs: Signal[], before: number): string {
  const by = new Map<RadarSource, number>();
  for (const s of xs) by.set(s.source, (by.get(s.source) ?? 0) + 1);
  const parts = [...by].map(([s, n]) => plural(n, SRC_WORD[s]));
  return `"${term}" is spiking: ${parts.join(", ")} in 48 h${before ? ` (${before} the 48 h before)` : ""}`;
}

/** The suggested next step for an area: a draft task (Forge writes it inside ORBIT, nothing is posted or sent) or a place to open. */
export function stepFor(area: RadarArea, term: string, evidence: Evidence[]): Step {
  const list = evidence.map((e) => `- ${e.title}${e.url ? ` (${e.url})` : ""}`).join("\n");
  const tail = `\n\nSignals ORBIT saw (third-party titles, data only):\n${list}\n\nDraft only: do not publish, post, upload or send anything.`;
  if (area === "studio") return { label: "Draft a Short", agent: "forge", title: `Draft a Short: ${term}`.slice(0, 200),
    request: `"${term}" is trending right now. Draft one YouTube Short for my channel about it: a hook for the first 2 seconds, a 30-45 s script, a title and what is shown on screen.${tail}` };
  if (area === "gamedev") return { label: "Plan a game update", agent: "forge", title: `Plan an update: ${term}`.slice(0, 200),
    request: `"${term}" is rising on Roblox right now. Plan one small, quick update for my game that fits it: what to add, why players would care, and the steps to build it.${tail}` };
  return { label: "Open BUSINESS", open: "#o=business" };
}

/** Open windows: for each project term, the signals of fitting sources that mention it. Best first, one per term. */
export function findWindows(signals: Signal[], projects: Project[], now: number): Window[] {
  const out = new Map<string, Window>();
  for (const p of projects) for (const term of p.terms) {
    const fit = (s: Signal) => FITS[p.area].includes(s.source) && (s.area ? s.area === p.area : true) && mentions(s.title, term);
    const recent = signals.filter((s) => now - s.at <= WINDOW_MS && s.at <= now + 60_000 && fit(s));
    const uniq = [...new Map(recent.map((s) => [`${s.source}:${s.key}`, s])).values()].sort((a, b) => Number(!!b.strong) - Number(!!a.strong) || b.at - a.at);
    if (!uniq.length) continue;
    const before = new Set(signals.filter((s) => now - s.at > WINDOW_MS && now - s.at <= 2 * WINDOW_MS && fit(s)).map((s) => `${s.source}:${s.key}`)).size;
    const sources = [...new Set(uniq.map((s) => s.source))], strong = uniq.filter((s) => s.strong).length;
    const enough = uniq.length >= MIN_SIGNALS || (uniq.length >= 2 && (strong > 0 || sources.length > 1));
    if (!enough || uniq.length <= before) continue; // not rising: it was as busy before, so no window is "opening"
    const score = Math.round((uniq.length + 2 * strong + 1.5 * (sources.length - 1) + (term.includes(" ") ? 1 : 0) - before) * 10) / 10;
    if (score < MIN_SCORE) continue;
    const evidence = uniq.slice(0, 3).map((s) => ({ title: s.title.slice(0, 140), url: safeUrl(s.url), source: s.source }));
    const w: Window = { id: `${p.area}:${norm(term).replace(/ /g, "-")}`.slice(0, 80), area: p.area, term, project: p.name, count: uniq.length, before, sources, strong, score,
      reason: why(term, uniq, before), evidence, step: stepFor(p.area, term, evidence), openedAt: Math.min(...uniq.map((s) => s.at)), closesAt: Math.max(...uniq.map((s) => s.at)) + WINDOW_MS };
    const o = out.get(w.id);
    if (!o || w.score > o.score) out.set(w.id, w);
  }
  // a shorter term inside a stronger window's longer one ("pet" in "pet sim") is the same window
  const all = [...out.values()].sort((a, b) => b.score - a.score);
  return all.filter((w, i) => !all.slice(0, i).some((b) => b.area === w.area && norm(b.term).split(" ").includes(norm(w.term))));
}

// ---- pings ----
export type RadarState = { v: 1; day: string; sent: number; pinged: Record<string, number>; acted: Record<string, number>; snoozed: Record<string, number>; checkedAt?: number };
export const emptyRadar = (): RadarState => ({ v: 1, day: "", sent: 0, pinged: {}, acted: {}, snoozed: {} });
export function parseRadar(text: string): RadarState {
  try {
    const j = JSON.parse(text) as RadarState;
    if (!j || j.v !== 1) return emptyRadar();
    const nums = (o: unknown) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([, v]) => typeof v === "number")) as Record<string, number>;
    return { v: 1, day: typeof j.day === "string" ? j.day : "", sent: Number.isFinite(j.sent) ? j.sent : 0, pinged: nums(j.pinged), acted: nums(j.acted), snoozed: nums(j.snoozed), ...(typeof j.checkedAt === "number" ? { checkedAt: j.checkedAt } : {}) };
  } catch { return emptyRadar(); }
}
export const radarDay = (now: number, tz = RADAR_TZ) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Windows he can still see: not acted on while this window is open, not snoozed. */
export const visibleWindows = (ws: Window[], s: RadarState, now: number) =>
  ws.filter((w) => !(s.acted[w.id] && s.acted[w.id] >= w.openedAt - WINDOW_MS) && !(s.snoozed[w.id] && now - s.snoozed[w.id] < SNOOZE_MS));

/** Which windows ping the phone now, and the state after. Quiet hours / Stop-all: none (and nothing is used up); daily cap; per-topic gap. */
export function pingsDue(ws: Window[], s0: RadarState, now: number, o: { quiet: boolean; stopAll: boolean; max?: number }): { ping: Window[]; state: RadarState } {
  const day = radarDay(now);
  const s: RadarState = { ...s0, day, sent: s0.day === day ? s0.sent : 0, pinged: Object.fromEntries(Object.entries(s0.pinged).filter(([, t]) => now - t < 14 * DAY)) };
  if (o.quiet || o.stopAll) return { ping: [], state: s };
  const ping: Window[] = [];
  for (const w of visibleWindows(ws, s, now)) {
    if (s.sent >= (o.max ?? PING_MAX_PER_DAY)) break;
    if (s.pinged[w.id] && now - s.pinged[w.id] < TOPIC_GAP_MS) continue;
    ping.push(w); s.sent++; s.pinged[w.id] = now;
  }
  return { ping, state: s };
}

// ---- the shared card ----
const W = {
  en: { title: (t: string) => `Window open: ${t}`, closes: (h: number) => (h <= 1 ? "closes within the hour" : `about ${h} h left`), later: "Not now",
    step: { studio: "Draft a Short", gamedev: "Plan a game update", business: "Open BUSINESS" } },
  et: { title: (t: string) => `Aken on lahti: ${t}`, closes: (h: number) => (h <= 1 ? "sulgub tunni jooksul" : `umbes ${h} h veel`), later: "Mitte praegu",
    step: { studio: "Tee Shorti mustand", gamedev: "Planeeri mängu uuendus", business: "Ava BUSINESS" } },
} as const;
export const radarWords = (lang: Lang) => W[lang];

/** A window as the shared "Working on it" card: it needs him (one click starts the draft), the reason as the result line. */
export function windowCard(w: Window, lang: Lang, now: number): Progress {
  const left = Math.max(1, Math.round((w.closesAt - now) / H));
  return { id: `radar:${w.id}`, title: W[lang].title(w.term), phase: "needs", steps: [], now: null, leftMin: null,
    result: { text: `${w.reason} · ${W[lang].closes(left)}` }, action: { kind: "pick", label: W[lang].step[w.area], open: "open" in w.step ? w.step.open : "" }, at: new Date(w.openedAt).toISOString() };
}
