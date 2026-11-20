// Better source picks for the Video Scout (pure, tested in tests/source-pick.test.ts). Separate from scout-pure.ts's ranking
// (pureScore / Claude): these are extra signals applied around it. I/O: source-probe.ts (yt-dlp heatmap probe), scout.ts (wiring).
//  - YouTube "Most replayed" heatmap with clear peaks = proven moments viewers rewatch → boost; no heatmap → neutral.
//  - already clipped (a job or download of the same video id) → skip.
//  - audio language known and not English → skip (clip jobs of other creators must be English); English → small boost.
//  - length: 20 min - 3 h is the sweet spot (enough moments, still fully transcribable); very long or short → small penalty.
//  - trending games: games named in several of this run's titles (weighted by views/hour) → boost videos of those games.
import { detectGame } from "./game-pure.ts";
import { heatStats, parseHeatmap, type HeatStats } from "./moments-pure.ts";

export type SourceCand = { id: string; title: string; channel: string; durationSec: number; publishedAt: string; stats: { views: number }; lang?: string };
export type Probe = { heat: HeatStats | null; lang?: string };
export type SourceSignal = { delta: number; notes: string[] };

/** Video ids of sources already clipped: yt-dlp names downloads "<uploader> - <title> [<id>].<ext>". */
export function clippedIds(sources: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) { const m = /\[([\w-]{11})\]\.[a-z0-9]+$/i.exec(s); if (m) out.add(m[1]); }
  return out;
}

/** Known audio language that isn't English ("en", "en-US", "en-GB" are English); unknown → false. */
export const nonEnglish = (lang?: string) => !!lang && !/^en(\b|[-_])/i.test(lang) && lang.toLowerCase() !== "en";

/** "Why skip" for the extra rules, or "" to keep: already clipped, non-English audio. */
export function sourceSkip(c: SourceCand, clipped: Set<string>): string {
  if (clipped.has(c.id)) return "clipped";
  if (nonEnglish(c.lang)) return "lang";
  return "";
}

const hoursSince = (iso: string, now: number) => Math.max(1, (now - Date.parse(iso)) / 3_600_000);

/** Games that appear in ≥ 2 of this run's titles, hottest first: score = summed log views/hour of the videos naming it. */
export function trendingGames(cs: SourceCand[], now: number, n = 3): { game: string; videos: number; score: number }[] {
  const by = new Map<string, { videos: number; score: number }>();
  for (const c of cs) {
    const g = detectGame(`${c.title} ${c.channel}`);
    if (!g) continue;
    const e = by.get(g) ?? { videos: 0, score: 0 };
    e.videos++;
    e.score += Math.log10(1 + c.stats.views / hoursSince(c.publishedAt, now));
    by.set(g, e);
  }
  return [...by].filter(([, e]) => e.videos >= 2).sort((a, b) => b[1].score - a[1].score).slice(0, n)
    .map(([game, e]) => ({ game, videos: e.videos, score: Math.round(e.score * 10) / 10 }));
}

/** Score change (points on the 0-100 scale) and the plain-words notes shown on the pick. */
export function sourceSignal(c: SourceCand, o: { trending: string[]; probe?: Probe }): SourceSignal {
  let delta = 0;
  const notes: string[] = [];
  const h = o.probe?.heat;
  if (h) {
    if (h.clear) { delta += Math.min(15, Math.round(5 + 3 * (h.peakX - 1.8) + 2 * Math.min(3, h.peaks))); notes.push(`📈 replay peaks ${h.peakX}× avg (${h.peaks} spike${h.peaks === 1 ? "" : "s"})`); }
    else { delta -= 3; notes.push("📉 flat replay graph"); }
  }
  const lang = o.probe?.lang || c.lang;
  if (lang && !nonEnglish(lang)) delta += 2;
  const min = c.durationSec / 60;
  if (min >= 20 && min <= 180) { delta += 3; notes.push("⏱ good length"); }
  else if (min > 300) { delta -= 5; notes.push("⏱ very long: only parts get transcribed"); }
  else if (min < 12) delta -= 3;
  const g = detectGame(`${c.title} ${c.channel}`);
  if (g && o.trending.includes(g)) { delta += 8 - 2 * o.trending.indexOf(g); notes.push(`🔥 trending game: ${g}`); }
  return { delta, notes };
}

/** Picks with the extra signals applied: score adjusted (0-100), notes kept as `signals`, re-sorted best first. */
export function applySourceSignals<P extends { videoId: string; score: number; signals?: string[] }>(picks: P[], sig: Map<string, SourceSignal>): (P & { signals?: string[] })[] {
  return picks.map((p) => {
    const s = sig.get(p.videoId);
    return s ? { ...p, score: Math.max(0, Math.min(100, p.score + s.delta)), signals: s.notes } : p;
  }).sort((a, b) => b.score - a.score);
}

/** Extra lines for Claude's ranking prompt (data: no angle brackets). */
export function signalPromptLines(cs: SourceCand[], probes: Map<string, Probe>, trending: string[]): string {
  const lines = cs.flatMap((c) => {
    const h = probes.get(c.id)?.heat;
    return h ? [`id=${c.id}: YouTube "Most replayed" graph peaks at ${h.peakX}× its average (${h.peaks} spikes)${h.clear ? "" : ", fairly flat"}`] : [];
  });
  return [trending.length ? `Games trending in this run's results: ${trending.join(", ")}.` : "", lines.length ? `Audience replay data (strong evidence of clip-worthy moments):\n${lines.join("\n")}` : ""]
    .filter(Boolean).join("\n").replace(/[<>]/g, "");
}

export const PROBE_MARK = "ORBIT_PROBE=";
/** yt-dlp `--print ORBIT_PROBE=%(.{heatmap,language})j` line → probe, else null. */
export function parseProbe(line: string): Probe | null {
  if (!line.startsWith(PROBE_MARK)) return null;
  let j: unknown;
  try { j = JSON.parse(line.slice(PROBE_MARK.length)); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const lang = (j as { language?: unknown }).language;
  return { heat: heatStats(parseHeatmap(j)), ...(typeof lang === "string" && lang ? { lang: lang.slice(0, 16) } : {}) };
}
