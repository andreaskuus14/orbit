import { listDownloads, runYtdlp, studioRoot, ytdlpPath } from "./factory";
import { youtubePauseUntil } from "./pure";
import { watchUrl } from "./scout-pure";
import { PROBE_MARK, parseProbe, type Probe } from "./source-pick-pure";

// Scout: yt-dlp metadata probe (no download, anonymous, read-only) of the top few candidates for YouTube's "Most replayed" heatmap and
// audio language. One extraction per video, at most `max` videos, sequential, 40 s each and 3 min in all; stops at the first
// "not a bot" wall and skips entirely while YouTube downloads are paused. Never throws: a missing probe just means no boost.

export async function probeSources(ids: string[], signal: AbortSignal, max = 6): Promise<{ probes: Map<string, Probe>; note?: string }> {
  const probes = new Map<string, Probe>();
  const yt = await ytdlpPath().catch(() => null);
  if (!yt || !ids.length) return { probes };
  if (youtubePauseUntil(await listDownloads().catch(() => []), watchUrl(ids[0]))) return { probes, note: "YouTube is blocking this PC for now: no replay-graph check" };
  const all = AbortSignal.any([signal, AbortSignal.timeout(3 * 60_000)]);
  for (const id of ids.slice(0, max)) {
    if (all.aborted) break;
    let got: Probe | null = null;
    try {
      await runYtdlp(yt, ["--ignore-config", "--encoding", "utf-8", "--no-playlist", "--skip-download", "--no-warnings",
        "--print", `${PROBE_MARK}%(.{heatmap,language})j`, "--", watchUrl(id)], AbortSignal.any([all, AbortSignal.timeout(40_000)]),
        (line, stdout) => { if (stdout) got = parseProbe(line) ?? got; }, studioRoot());
    } catch (e) {
      if (/not a bot|blocked/i.test(e instanceof Error ? e.message : String(e))) return { probes, note: "YouTube asked to confirm we're not a bot: replay-graph check stopped" };
    }
    if (got) probes.set(id, got);
  }
  return { probes };
}
