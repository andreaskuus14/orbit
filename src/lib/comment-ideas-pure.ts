// Comment-to-idea (pure, tested in tests/comment-ideas.test.ts): recurring viewer questions/requests on his recent videos → IDEA RADAR
// ideas linked to the source comments. Token-overlap clustering (no model calls). Nothing here writes to YouTube.
import type { Idea } from "./ideas-pure.ts";

export type RawComment = { id: string; videoId: string; author: string; text: string; publishedAt: string };
export type CommentCluster = { key: string; askers: number; comments: RawComment[]; terms: string[]; sample: string };
export const MIN_ASKERS = 3;
export const SIMILAR = 0.34; // Jaccard: "what software do you edit with" ~ "how do you edit your videos"
export const COMMENT_IDEAS_EVERY_MS = 24 * 3_600_000;

const STOP = new Set(("a an the and or but if so to of in on at for with from by about as is are was were be been being am do does did done doing have has had "
  + "i me my mine you your yours u ur he she it its we us our they them their this that these those there here what which who whom whose when where why how "
  + "can could would should will shall may might must pls plz please bro bruh lol lmao omg just really very too also more most much many some any all "
  + "make made use using get got go going gonna wanna want like love know think need one thing things video videos vid vids short shorts channel guys man yes no not "
  + "dont im ive youre whats hows thats it's i'm don't what's you're next new").split(" "));
const ASK = /\?|^(how|what|which|why|where|when|who|can|could|would|will|do|does|is|are|should)\b|\b(please|pls|plz|part 2|part two|tutorial|make (a|an|more)|do (a|an|more)|next video|can you|could you|will you|would you|i wish|i want|you should|request|show us|teach)\b/;

/** Lowercase, no links/mentions/emoji/punctuation, single spaces. */
export const normalizeComment = (text: string) => text.toLowerCase().replace(/https?:\/\/\S+|www\.\S+/g, " ").replace(/@[\w.-]+/g, " ")
  .replace(/[’']/g, "").replace(/[^\p{L}\p{N}?\s]/gu, " ").replace(/\s+/g, " ").trim();
const stem = (w: string) => w.length > 4 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
export const commentTokens = (text: string) => [...new Set(normalizeComment(text).replace(/\?/g, " ").split(" ").filter((w) => w && !STOP.has(w)).map(stem))];
export const isAsk = (text: string) => ASK.test(normalizeComment(text));

export function jaccard(a: string[], b: string[]): number {
  const x = new Set(a), inter = b.filter((w) => x.has(w)).length;
  return a.length + b.length ? inter / (a.length + b.length - inter) : 0;
}

/** Questions/requests only; one per (author, normalized text) and per comment id. */
export function dedupeComments(list: RawComment[]): RawComment[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.author.toLowerCase()}|${normalizeComment(c.text).replace(/\?/g, "").trim()}`;
    if (!c.id || seen.has(c.id) || seen.has(k) || !isAsk(c.text) || !commentTokens(c.text).length) return false;
    seen.add(c.id); seen.add(k); return true;
  });
}

/** Single-link clusters (a comment joins the cluster holding its most similar comment); only clusters with ≥ MIN_ASKERS distinct authors. */
export function clusterComments(list: RawComment[], threshold = SIMILAR): CommentCluster[] {
  const items = dedupeComments(list).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id)).map((c) => ({ c, t: commentTokens(c.text) }));
  const groups: (typeof items)[] = [];
  for (const it of items) {
    let best = -1, score = 0;
    groups.forEach((g, i) => { for (const m of g) { const s = jaccard(it.t, m.t); if (s > score) { score = s; best = i; } } });
    if (best >= 0 && score >= threshold) groups[best].push(it); else groups.push([it]);
  }
  return groups.flatMap((g) => {
    const askers = new Set(g.map((x) => x.c.author.toLowerCase())).size;
    if (askers < MIN_ASKERS) return [];
    const freq = new Map<string, number>();
    for (const x of g) for (const w of x.t) freq.set(w, (freq.get(w) ?? 0) + 1);
    const terms = [...freq].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w);
    // The most typical comment: the one sharing the most words with the rest, shorter on ties.
    const sample = [...g].sort((a, b) => g.reduce((n, y) => n + jaccard(b.t, y.t), 0) - g.reduce((n, y) => n + jaccard(a.t, y.t), 0) || a.c.text.length - b.c.text.length)[0].c.text;
    return [{ key: [...terms].sort().join("+"), askers, comments: g.map((x) => x.c), terms, sample }];
  }).sort((a, b) => b.askers - a.askers || a.key.localeCompare(b.key));
}

type Thread = { id?: string; snippet?: { channelId?: string; topLevelComment?: { id?: string; snippet?: { authorDisplayName?: string; authorChannelId?: { value?: string };
  textOriginal?: string; textDisplay?: string; publishedAt?: string } } } };
/** commentThreads.list JSON → top-level viewer comments (the channel's own comments skipped). */
export function parseThreads(r: { items?: Thread[] } | null | undefined, videoId: string): RawComment[] {
  return (r?.items ?? []).flatMap((t) => {
    const sn = t?.snippet, c = sn?.topLevelComment?.snippet, id = t?.id ?? sn?.topLevelComment?.id, text = (c?.textOriginal ?? c?.textDisplay ?? "").slice(0, 1000);
    if (!c || typeof id !== "string" || !text.trim() || (sn?.channelId && c.authorChannelId?.value === sn.channelId)) return [];
    return [{ id, videoId, author: c.authorChannelId?.value || c.authorDisplayName || "viewer", text, publishedAt: typeof c.publishedAt === "string" ? c.publishedAt : "" }];
  });
}

export const commentUrl = (c: { id: string; videoId: string }) => `https://www.youtube.com/watch?v=${c.videoId}&lc=${encodeURIComponent(c.id)}`;
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Merges clusters into the ideas list: an idea sharing a comment (or the key) with a cluster is updated in place (id and dismissal kept),
 *  others are added. Returns the full new list and how many ideas were new. */
export function mergeCommentIdeas(ideas: Idea[], clusters: CommentCluster[], titles: Record<string, string>, now: string, makeId: () => string): { ideas: Idea[]; added: number } {
  const out = [...ideas];
  let added = 0;
  for (const c of clusters) {
    const ids = new Set(c.comments.map((x) => x.id));
    const i = out.findIndex((x) => x.origin === "comments" && (x.commentKey === c.key || x.comments?.some((y) => ids.has(y.id))));
    const top = [...c.comments].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
    const video = c.comments[0].videoId;
    const idea: Idea = { id: i >= 0 ? out[i].id : makeId(), origin: "comments", commentKey: c.key, video, videoTitle: `Comments on ${titles[video] || video}`,
      title: clip(`Viewers ask: ${c.sample}`, 120), summary: `${c.askers} different viewers asked about ${c.terms.join(", ")}.`, area: "studio",
      score: Math.min(95, 60 + 5 * (c.askers - MIN_ASKERS)), next: "Answer it in your next Short; any reply you write stays a draft until you post it yourself.",
      at: i >= 0 ? out[i].at : now, sourceAt: top.publishedAt || undefined, dismissed: i >= 0 ? out[i].dismissed : undefined, askers: c.askers,
      comments: c.comments.slice(0, 20).map((x) => ({ id: x.id, videoId: x.videoId, text: clip(x.text, 200) })) };
    if (i >= 0) out[i] = idea; else { out.unshift(idea); added++; }
  }
  return { ideas: out, added };
}
