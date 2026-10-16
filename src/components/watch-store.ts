import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import type { PanelId } from "@/lib/planets";
import { afterPage, autoLoad, dedupe, findMode, mergeByDate, parseWatchChoice, parseWatchCommand, parseWatchControl, watchReply, type Sort, type WatchCommand, type WatchVideo } from "@/lib/watch-pure";
import { addCreator, addTopic, addWatched, parseCreators, parseHistory, parseTopics, removeCreator, removeTopic, togglePin, type SavedCreator, type Watched } from "@/lib/theater-history-pure";

// THEATER state shared by the command bar / voice (runWatchCommand) and TheaterWorld. Module state, not React: the find
// starts before the world has mounted (it's still flying there).

export type FeedKind = "creator" | "topic" | "trending" | "all";
export type WatchState = {
  creator: string; shorts: boolean; status: "loading" | "ready" | "error"; error?: string;
  channel?: { id: string; title: string }; videos: WatchVideo[]; playing: number | null; notice?: string;
  askedAt?: number; // "Which one should I open?" was asked: the next utterance may be the answer (for 60 s, once)
  topic?: string; // the selected category chip ("CS2", "All", "Trending")
  note?: string; // "No channel @x — showing videos about “x”"
  kind?: FeedKind; sort?: Sort; fallback?: boolean; // what to ask the server for the next page
  next?: string; pages?: number; more?: boolean; stalled?: boolean; // endless scroll: page token, pages loaded, loading one, stopped (failed / no growth)
  emptyRun?: number; // pages in a row that added nothing
  unitsLeft?: number; // today's YouTube units left (as of the last paid call)
};
type Found = { channel?: { id: string; title: string }; topic?: string; note?: string; videos?: WatchVideo[]; next?: string; unitsLeft?: number; error?: string };
const lookup = async (q: Record<string, string>, what: string): Promise<Found> => {
  const res = await fetch(`/api/theater?${new URLSearchParams(q)}`, { cache: "no-store" });
  const json: Found = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Couldn't look up ${what} (${res.status})`);
  return json;
};
/** The server query for a feed (page = the next page's token). fallback=1 only on the typed/spoken Find. */
function feedQuery(s: WatchState, page?: string): Record<string, string> {
  const q: Record<string, string> = s.kind === "trending" ? { trending: "1" } : s.kind === "topic" ? { topic: s.creator } : { creator: s.creator };
  if (s.kind === "creator" && s.fallback && !page) q.fallback = "1";
  q.sort = s.sort ?? "viral";
  if (s.shorts) q.shorts = "1";
  if (page) q.page = page;
  return q;
}
/** Player commands TheaterWorld carries out (detail: "pauseVideo" | "playVideo" | "fullscreen" | "exitFullscreen"). */
export const WATCH_CONTROL = "orbit:watch-control";

let state: WatchState | null = null;
const subs = new Set<() => void>();
export const getWatch = () => state;
export const subscribeWatch = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setWatch(next: WatchState | null) { state = next; subs.forEach((f) => f()); }
const patch = (p: Partial<WatchState>) => { if (state) setWatch({ ...state, ...p }); };

// Paid topic pages (101 units each) per feed for this session: switching chips or sort back and forth can't re-spend the auto-load allowance.
const topicPages = new Map<string, number>();
const feedKey = (s: WatchState) => `${s.kind}|${s.creator.toLowerCase()}|${s.sort}|${s.shorts}`;
const countPage = (s: WatchState) => { if (s.kind === "topic") topicPages.set(feedKey(s), (topicPages.get(feedKey(s)) ?? 0) + 1); };
/** Whether the endless scroll may fetch the next page by itself (the UI shows "Load more" otherwise). */
export const canAutoLoad = (s: WatchState) => autoLoad(s.kind, s.kind === "topic" ? topicPages.get(feedKey(s)) ?? 0 : s.pages ?? 1, !!s.stalled);
// Units left today, as the lowest value any response reported (responses can arrive out of order).
const minUnits = (a?: number, b?: number) => (a == null ? b : b == null ? a : Math.min(a, b));

let seq = 0;
type Say = (msg: string, ok: boolean) => void;
/** Looks the creator (or topic) up; say() gets "Found … Which one should I open?" or the error. An unknown creator comes back
 *  as a topic search (with a note). */
export function findVideos(cmd: WatchCommand, say?: Say, sort: Sort = "viral") {
  startFeed({ creator: cmd.creator, shorts: cmd.shorts, status: "loading", videos: [], playing: null, kind: cmd.topic ? "topic" : "creator", sort,
    topic: cmd.topic ? cmd.creator : undefined, fallback: !cmd.topic }, say);
}
/** "📈 Trending Gaming": YouTube's Gaming chart, 1 unit a page. */
export const findTrending = () => startFeed({ creator: "Trending Gaming", shorts: false, status: "loading", videos: [], playing: null, kind: "trending", sort: "viral", topic: "Trending" });

function startFeed(base: WatchState, say?: Say) {
  const n = ++seq;
  setWatch({ ...base, unitsLeft: state?.unitsLeft });
  lookup(feedQuery(base), base.creator)
    .then((json) => {
      if (n !== seq) return;
      const videos = json.videos ?? [];
      const fellBack = base.kind === "creator" && !json.channel && !!json.topic;
      if (json.channel) setSaved({ creators: addCreator(saved().creators, base.creator) });
      const ready: WatchState = { ...base, status: "ready", channel: json.channel, videos, next: json.next, pages: 1, unitsLeft: minUnits(json.unitsLeft, state?.unitsLeft),
        kind: fellBack ? "topic" : base.kind, topic: fellBack ? base.creator : base.topic, note: json.note, askedAt: videos.length ? Date.now() : undefined };
      countPage(ready);
      setWatch(ready);
      const reply = watchReply(json.channel?.title ?? json.topic ?? base.creator, videos, base.shorts, !json.channel);
      say?.(json.note ? `${json.note}. ${reply}` : reply, true);
    })
    .catch((e) => {
      if (n !== seq) return;
      const msg = e instanceof Error ? e.message : `Couldn't look up ${base.creator}`;
      patch({ status: "error", error: msg });
      say?.(msg, false);
    });
}

/** Endless scroll: appends the next page (deduped). `manual` = the "Load more" button (topic pages cost 101 units each, so only
 *  the first 3 load by themselves). */
export function loadMore(manual = false) {
  const s = state;
  if (!s || s.status !== "ready" || !s.next || s.more || (!manual && !canAutoLoad(s))) return;
  const n = seq;
  patch({ more: true });
  lookup(feedQuery(s, s.next), s.creator)
    .then((json) => {
      if (n !== seq || !state) return;
      countPage(state);
      const videos = dedupe([...state.videos, ...(json.videos ?? [])]);
      const { emptyRun, stalled } = afterPage(state.kind, state.videos.length, videos.length, s.next, json.next, state.emptyRun);
      setWatch({ ...state, more: false, stalled, emptyRun, videos, next: json.next, pages: (state.pages ?? 1) + 1, unitsLeft: minUnits(json.unitsLeft, state.unitsLeft) });
    })
    .catch((e) => { if (n === seq) patch({ more: false, stalled: true, notice: e instanceof Error ? e.message : "Couldn't load more" }); });
}

/** 🔥 Viral / 🆕 Newest: reloads the current feed in that order. */
export function setSort(sort: Sort) {
  const s = state;
  if (!s || s.sort === sort || s.kind === "trending") return;
  if (s.kind === "all") return findAll(sort);
  startFeed({ creator: s.creator, shorts: s.shorts, status: "loading", videos: [], playing: null, kind: s.kind, sort, topic: s.topic, fallback: false });
}

/** "All": the newest uploads of the first 4 saved creators (pinned first), merged. Each is 2-3 units unless the server's
 *  10-minute cache has it; always fetched newest-first (one cache entry), then ordered by `sort`. */
export function findAll(sort: Sort = "viral") {
  const n = ++seq, names = saved().creators.slice(0, 4).map((c) => c.name);
  const base: WatchState = { creator: "All", shorts: false, status: "ready", videos: [], playing: null, topic: "All", kind: "all", sort, unitsLeft: state?.unitsLeft };
  if (!names.length) return setWatch({ ...base, note: "Search a creator first: All shows your creators' newest videos." });
  setWatch({ ...base, status: "loading" });
  void Promise.allSettled(names.map((c) => lookup({ creator: c, sort: "new" }, c))).then((rs) => {
    if (n !== seq) return;
    const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = rs.length - ok.length;
    setWatch({ ...base, videos: mergeByDate(ok.map((j) => j.videos ?? []), 48, sort), unitsLeft: ok.reduce((m, j) => minUnits(m, j.unitsLeft), base.unitsLeft),
      note: failed ? `${failed} of ${rs.length} creators couldn't be loaded.` : undefined });
  });
}

export function play(i: number | null) {
  const v = i !== null ? state?.videos[i] : undefined;
  if (v && state) setSaved({ history: addWatched(saved().history, v, v.channel || state.channel?.title || state.creator, Date.now()) });
  patch({ playing: i, notice: undefined, askedAt: undefined });
}
export const closeWatch = () => { seq++; setWatch(null); };
const control = (c: string) => dispatchEvent(new CustomEvent(WATCH_CONTROL, { detail: c }));

/** "show me Jynxzi's latest videos" anywhere; inside THEATER also the answer ("the second one", "yes", "no") and player
 *  controls ("pause", "next video", "full screen", "close video"). Returns false when the text is none of these (it goes on to
 *  navigation or CORE as before). say(msg) = what ORBIT should say ("" = nothing to say). */
export function runWatchCommand(text: string, current: PanelId | null, say: Say): boolean {
  // An open list/player hears its own controls and answers first: "play the next video" must not become a topic search.
  const s = state;
  const here = !!s && current === "theater" && s.status === "ready";
  if (here && s && inTheater(s, text, say)) return true;
  const cmd = parseWatchCommand(text);
  if (cmd) {
    dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "theater" } }));
    // "show me the newest cs2 videos": a game shorthand / category is a topic, never a channel lookup (@cs2 is someone else)
    findVideos({ ...cmd, topic: cmd.topic || findMode(cmd.creator, saved().topics) === "topic" }, say, /\b(?:newest|latest|most recent|recent|new)\b/i.test(text) ? "new" : "viral");
    return true;
  }
  if (here && s?.askedAt) patch({ askedAt: undefined }); // not an answer: later "yes"/"no" belong to CORE
  return false;
}

function inTheater(s: WatchState, text: string, say: Say): boolean {
  if (s.playing !== null) {
    const c = parseWatchControl(text);
    if (c === "close") { play(null); control("exitFullscreen"); say("", true); return true; }
    if (c === "next") {
      if (s.playing + 1 < s.videos.length) { play(s.playing + 1); say("", true); } else say("That was the last one.", true);
      return true;
    }
    if (c) { control(c === "pause" ? "pauseVideo" : c === "play" ? "playVideo" : c); say("", true); return true; }
  }
  if (!s.askedAt || Date.now() - s.askedAt > 60_000) return false;
  const ch = parseWatchChoice(text, s.videos.length, s.playing === null);
  if (ch === null) return false;
  if (ch === "cancel") { closeWatch(); say("Okay.", true); } else { play(ch); say("", true); }
  return true;
}

// "Your creators" chips + "Continue watching", kept in localStorage (try/catch: private mode / blocked storage just means no memory).
type Saved = { creators: SavedCreator[]; history: Watched[]; topics: string[] };
const CREATORS_KEY = "orbit.theater.creators", HISTORY_KEY = "orbit.theater.history", TOPICS_KEY = "orbit.theater.topics";
const EMPTY: Saved = { creators: [], history: [], topics: parseTopics(null) };
let savedState: Saved | null = null;
const savedSubs = new Set<() => void>();
const load = (k: string): unknown => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no storage: in-memory only */ } };
/** Snapshot for useSyncExternalStore (same object until something changes). */
export const getSaved = (): Saved => typeof window === "undefined" ? EMPTY : saved();
export const getSavedServer = () => EMPTY;
function saved(): Saved {
  return (savedState ??= typeof window === "undefined" ? EMPTY : { creators: parseCreators(load(CREATORS_KEY)), history: parseHistory(load(HISTORY_KEY)), topics: parseTopics(load(TOPICS_KEY)) });
}
export const subscribeSaved = (f: () => void) => { savedSubs.add(f); return () => { savedSubs.delete(f); }; };
function setSaved(p: Partial<Saved>) {
  savedState = { ...saved(), ...p };
  if (p.creators) store(CREATORS_KEY, p.creators);
  if (p.history) store(HISTORY_KEY, p.history);
  if (p.topics) store(TOPICS_KEY, p.topics);
  savedSubs.forEach((f) => f());
}
export const pinCreator = (name: string) => setSaved({ creators: togglePin(saved().creators, name) });
export const saveTopic = (t: string) => setSaved({ topics: addTopic(saved().topics, t) });
export const forgetTopic = (t: string) => setSaved({ topics: removeTopic(saved().topics, t) });
export const forgetCreator = (name: string) => setSaved({ creators: removeCreator(saved().creators, name) });
/** Re-opens a watched video straight in the player: no lookup, no YouTube units. */
export function replay(v: Watched) {
  seq++; // a lookup still in flight must not replace this
  setWatch({ creator: v.channel, shorts: false, status: "ready", videos: [v], playing: null });
  play(0);
}
