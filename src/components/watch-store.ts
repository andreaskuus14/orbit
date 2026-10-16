import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import type { PanelId } from "@/lib/planets";
import { parseWatchChoice, parseWatchCommand, parseWatchControl, watchReply, type WatchCommand, type WatchVideo } from "@/lib/watch-pure";
import { addCreator, addWatched, parseCreators, parseHistory, removeCreator, togglePin, type SavedCreator, type Watched } from "@/lib/theater-history-pure";

// THEATER state shared by the command bar / voice (runWatchCommand) and TheaterWorld. Module state, not React: the find
// starts before the world has mounted (it's still flying there).

export type WatchState = {
  creator: string; shorts: boolean; status: "loading" | "ready" | "error"; error?: string;
  channel?: { id: string; title: string }; videos: WatchVideo[]; playing: number | null; notice?: string;
  askedAt?: number; // "Which one should I open?" was asked: the next utterance may be the answer (for 60 s, once)
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
/** Looks the creator up; say() gets "Found 3 new … Which one should I open?" or the error. */
export function findVideos(cmd: WatchCommand, say?: Say) {
  const n = ++seq;
  setWatch({ creator: cmd.creator, shorts: cmd.shorts, status: "loading", videos: [], playing: null });
  fetch(`/api/theater?${new URLSearchParams({ creator: cmd.creator, ...(cmd.shorts ? { shorts: "1" } : {}) })}`, { cache: "no-store" })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't look up ${cmd.creator} (${res.status})`);
      if (n !== seq) return;
      setSaved({ creators: addCreator(saved().creators, cmd.creator) });
      setWatch({ creator: cmd.creator, shorts: cmd.shorts, status: "ready", channel: json.channel, videos: json.videos ?? [], playing: null, askedAt: json.videos?.length ? Date.now() : undefined });
      say?.(watchReply(json.channel?.title ?? cmd.creator, json.videos ?? [], cmd.shorts), true);
    })
    .catch((e) => {
      if (n !== seq) return;
      const msg = e instanceof Error ? e.message : `Couldn't look up ${cmd.creator}`;
      patch({ status: "error", error: msg });
      say?.(msg, false);
    });
}

export function play(i: number | null) {
  const v = i !== null ? state?.videos[i] : undefined;
  if (v && state) setSaved({ history: addWatched(saved().history, v, state.channel?.title ?? state.creator, Date.now()) });
  patch({ playing: i, notice: undefined, askedAt: undefined });
}
export const closeWatch = () => { seq++; setWatch(null); };
const control = (c: string) => dispatchEvent(new CustomEvent(WATCH_CONTROL, { detail: c }));

/** "show me Jynxzi's latest videos" anywhere; inside THEATER also the answer ("the second one", "yes", "no") and player
 *  controls ("pause", "next video", "full screen", "close video"). Returns false when the text is none of these (it goes on to
 *  navigation or CORE as before). say(msg) = what ORBIT should say ("" = nothing to say). */
export function runWatchCommand(text: string, current: PanelId | null, say: Say): boolean {
  const cmd = parseWatchCommand(text);
  if (cmd) {
    dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "theater" } }));
    findVideos(cmd, say);
    return true;
  }
  const s = state;
  if (!s || current !== "theater" || s.status !== "ready") return false;
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
  if (ch === null) { patch({ askedAt: undefined }); return false; } // not an answer: later "yes"/"no" belong to CORE
  if (ch === "cancel") { closeWatch(); say("Okay.", true); } else { play(ch); say("", true); }
  return true;
}

// "Your creators" chips + "Continue watching", kept in localStorage (try/catch: private mode / blocked storage just means no memory).
type Saved = { creators: SavedCreator[]; history: Watched[] };
const CREATORS_KEY = "orbit.theater.creators", HISTORY_KEY = "orbit.theater.history";
const EMPTY: Saved = { creators: [], history: [] };
let savedState: Saved | null = null;
const savedSubs = new Set<() => void>();
const load = (k: string): unknown => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no storage: in-memory only */ } };
/** Snapshot for useSyncExternalStore (same object until something changes). */
export const getSaved = (): Saved => typeof window === "undefined" ? EMPTY : saved();
export const getSavedServer = () => EMPTY;
function saved(): Saved {
  return (savedState ??= typeof window === "undefined" ? EMPTY : { creators: parseCreators(load(CREATORS_KEY)), history: parseHistory(load(HISTORY_KEY)) });
}
export const subscribeSaved = (f: () => void) => { savedSubs.add(f); return () => { savedSubs.delete(f); }; };
function setSaved(p: Partial<Saved>) {
  savedState = { ...saved(), ...p };
  if (p.creators) store(CREATORS_KEY, p.creators);
  if (p.history) store(HISTORY_KEY, p.history);
  savedSubs.forEach((f) => f());
}
export const pinCreator = (name: string) => setSaved({ creators: togglePin(saved().creators, name) });
export const forgetCreator = (name: string) => setSaved({ creators: removeCreator(saved().creators, name) });
/** Re-opens a watched video straight in the player: no lookup, no YouTube units. */
export function replay(v: Watched) {
  seq++; // a lookup still in flight must not replace this
  setWatch({ creator: v.channel, shorts: false, status: "ready", videos: [v], playing: null });
  play(0);
}
