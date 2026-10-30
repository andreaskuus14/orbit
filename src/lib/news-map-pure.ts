// INTELLIGENCE globe legend (INT05). Kept import-free: the public demo renders NewsGlobe. Tested in tests/news-feedback.test.ts.
/** What the globe shows, per time window. Location = countries a story NAMES (headline mentions weigh 3×): what it's about,
 *  not a confirmed event location and not the publisher's country. Size = coverage (stories naming it), not significance.
 *  The window is by fetch time (when ORBIT stored the story), as /api/news/geo filters. */
export function mapLegend(d: { hours: number; total: number; untagged: number }, now: number) {
  const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  return { from: at(now - d.hours * 3600_000), to: at(now), hours: d.hours, placed: d.total - d.untagged, total: d.total, untagged: d.untagged,
    location: "named" as const, size: "coverage" as const, by: "fetched" as const };
}
