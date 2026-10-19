import { REACH_SOURCES, fenceUntrusted, trendingText, type ReachSource } from "./pure";

// CORE's read-only Reach tools. Results are third-party text: fenced and capped before they enter the prompt.
export async function runReachTool(tool: "reach_trending" | "reach_read", input: Record<string, unknown>): Promise<string> {
  try {
    if (tool === "reach_trending") {
      const raw = typeof input.source === "string" ? input.source.toLowerCase().trim() : "";
      const source = (REACH_SOURCES as string[]).includes(raw) ? (raw as ReachSource) : null;
      if (raw && !source) return `Error: source must be one of ${REACH_SOURCES.join(", ")}`;
      const s = await (await import("./index")).reachNow();
      if (s.stopped) return "Error: Stop-all is on, so Reach isn't scanning";
      const hints = (source ? [source] : REACH_SOURCES).flatMap((x) => s.hints[x]);
      const age = s.at ? `scanned ${Math.round((Date.now() - s.at) / 60_000)} min ago` : "first scan still running";
      return fenceUntrusted(`Reach trending (${source ?? "all sources"}, ${age})`, trendingText(s.items, source, hints, 10), 4000);
    }
    const url = typeof input.url === "string" ? input.url.trim().slice(0, 2000) : "";
    if (!url) return "Error: url is required";
    const page = await (await import("./read")).readUrl(url, 6000);
    return fenceUntrusted(`${page.title} — ${page.url}${page.via === "jina" ? " (via Jina Reader)" : ""}`, page.text, 6000);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
  }
}
