import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import type { PanelId } from "@/lib/planets";
import { mergeByDate, parseWatchChoice, parseWatchCommand, parseWatchControl, watchReply, type WatchCommand, type WatchVideo } from "@/lib/watch-pure";
import { addCreator, addTopic, addWatched, parseCreators, parseHistory, parseTopics, removeCreator, removeTopic, togglePin, type SavedCreator, type Watched } from "@/lib/theater-history-pure";

// THEATER state shared by the command bar / voice (runWatchCommand) and TheaterWorld. Module state, not React: the find
// starts before the world has mounted (it's still flying there).

export type WatchState = {
  creator: string; shorts: boolean; status: "loading" | "ready" | "error"; error?: string;
  channel?: { id: string; title: string }; videos: WatchVideo[]; playing: number | null; notice?: string;
  askedAt?: number; // "Which one should I open?" was asked: the next utterance may be the answer (for 60 s, once)
  topic?: string; // a topic grid ("CS2", or "All" = saved creators merged); its chip shows as selected
  note?: string; // "No channel @x — showing videos about “x”"
};
type Found = { channel?: { id: string; title: string }; topic?: string; note?: string; videos?: WatchVideo[]; error?: string };
const lookup = async (q: Record<string, string>, what: string): Promise<Found> => {
  const res = await fetch(`/api/theater?${new URLSearchParams(q)}`, { cache: "no-store" });
  const json: Found = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Couldn't look up ${what} (${res.status})`);
  return json;
};
/** Player commands TheaterWorld carries out (detail: "pauseVideo" | "playVideo" | "fullscreen" | "exitFullscreen"). */
export const WATCH_CONTROL = "orbit:watch-control";

let state: WatchState | null = null;
const subs = new Set<() => void>();
export const getWatch = () => state;
export const subscribeWatch = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setWatch(next: WatchState | null) { state = next; subs.forEach((f) => f()); }
const patch = (p: Partial<WatchState>) => { if (state) setWatch({ ...state, ...p }); };

let seq = 0;
type Say = (msg: string, ok: boolean) => void;
/** Looks the creator (or topic) up; say() gets "Found 3 new … Which one should I open?" or the error. An unknown creator comes
 *  back as a topic search (with a note). */
export function findVideos(cmd: WatchCommand, say?: Say) {
  const n = ++seq;
  setWatch({ creator: cmd.creator, shorts: cmd.shorts, status: "loading", videos: [], playing: null, topic: cmd.topic ? cmd.creator : undefined });
  lookup(cmd.topic ? { topic: cmd.creator, ...(cmd.shorts ? { shorts: "1" } : {}) } : { creator: cmd.creator, fallback: "1", ...(cmd.shorts ? { shorts: "1" } : {}) }, cmd.creator)
    .then((json) => {
      if (n !== seq) return;
      const videos = json.videos ?? [];
      if (json.channel) setSaved({ creators: addCreator(saved().creators, cmd.creator) });
      setWatch({ creator: cmd.creator, shorts: cmd.shorts, status: "ready", channel: json.channel, videos, playing: null, askedAt: videos.length ? Date.now() : undefined,
        topic: json.topic ? cmd.creator : undefined, note: json.note });
      const reply = watchReply(json.channel?.title ?? json.topic ?? cmd.creator, videos, cmd.shorts, !json.channel && !!json.topic);
      say?.(json.note ? `${json.note}. ${reply}` : reply, true);
    })
    .catch((e) => {
      if (n !== seq) return;
      const msg = e instanceof Error ? e.message : `Couldn't look up ${cmd.creator}`;
      patch({ status: "error", error: msg });
      say?.(msg, false);
    });
}

/** "All": the newest uploads of the first 4 saved creators (pinned first), merged by date. Each is 2-3 units unless the server's
 *  10-minute cache has it. */
export function findAll() {
  const n = ++seq, names = saved().creators.slice(0, 4).map((c) => c.name);
  if (!names.length) {
    setWatch({ creator: "All", shorts: false, status: "ready", videos: [], playing: null, topic: "All", note: "Search a creator first: All shows your creators' newest videos." });
    return;
  }
  setWatch({ creator: "All", shorts: false, status: "loading", videos: [], playing: null, topic: "All" });
  void Promise.allSettled(names.map((c) => lookup({ creator: c }, c))).then((rs) => {
    if (n !== seq) return;
    const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const videos = mergeByDate(ok.map((j) => (j.videos ?? []).map((v) => ({ ...v, channel: v.channel || j.channel?.title }))));
    const failed = rs.length - ok.length;
    setWatch({ creator: "All", shorts: false, status: "ready", videos, playing: null, topic: "All", note: failed ? `${failed} of ${rs.length} creators couldn't be loaded.` : undefined });
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
    findVideos(cmd, say);
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
