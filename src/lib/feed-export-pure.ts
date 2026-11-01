// Portable subscriptions; export existing records without fetching feeds or sending them anywhere.
type Subscription = { url: string; title: string | null; topic: string | null };
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

/** OPML 2.0 subscription list. Skip invalid URLs and embedded credentials; keep paused subscriptions too. */
export function feedsOpml(feeds: Subscription[]): string {
  const seen = new Set<string>();
  const rows = feeds.flatMap((f) => {
    let u: URL;
    try { u = new URL(f.url); } catch { return []; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || seen.has(u.href)) return [];
    seen.add(u.href);
    const label = xml(f.title || f.topic || u.hostname);
    return [`    <outline type="rss" text="${label}" title="${label}" xmlUrl="${xml(u.href)}" />`];
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>ORBIT subscriptions</title></head>\n  <body>\n${rows.join("\n")}\n  </body>\n</opml>\n`;
}
