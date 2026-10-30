// Audio priority engine (roadmap G13+G14): watches the mic, ORBIT's voice and THEATER playback, and tells the ambience and
// UI-cue layers how loud to be. Rules live in lib/audio-policy-pure.ts; each layer ramps its own gain (no clicks).
import { AUDIO_IDLE, MUTE_KEY, holdAnnouncement, targetGains, type AudioState } from "@/lib/audio-policy-pure";
import { onSpeakingChange, isSpeaking, speakChunk } from "./voice/speak";
import { VOICE_PAUSE, VOICE_RESUME } from "./voice/useVoiceInput";
import { WAKE_HEARING } from "./voice/bus";
import { getWatch, subscribeWatch } from "./watch-store";
import { THEATER_EVENT } from "@/lib/interruption-pure";

let state: AudioState = { ...AUDIO_IDLE, muted: readMute() };
let held: string[] = [];
const subs = new Set<() => void>();

function readMute() { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } }
export const audioState = () => state;
export const audioGains = () => targetGains(state);
export const subscribeAudio = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

function set(p: Partial<AudioState>) {
  const next = { ...state, ...p };
  if (Object.keys(p).every((k) => next[k as keyof AudioState] === state[k as keyof AudioState])) return;
  state = next;
  subs.forEach((f) => f());
  if ("media" in p) dispatchEvent(new CustomEvent(THEATER_EVENT, { detail: state.media })); // Herald holds non-urgent pop-ups
  if (!holdAnnouncement(state, false) && held.length) { const h = held; held = []; h.forEach((t) => speakChunk(t)); }
}

export function setMuted(on: boolean) {
  try { localStorage.setItem(MUTE_KEY, on ? "1" : "0"); } catch { /* private mode: this tab only */ }
  set({ muted: on });
}

/** Speak a line now, or once THEATER stops / mute lifts when it is not urgent. */
export function announce(text: string, urgent = false) {
  if (holdAnnouncement(state, urgent)) held = [...held.slice(-2), text]; // keep the latest three, not a backlog
  else speakChunk(text);
}

let started = false;
/** Once in the app (AmbientSound): wire the three signals. */
export function initAudioPolicy() {
  if (started || typeof window === "undefined") return;
  started = true;
  let ptt = false, wake = false; // either listener holding the mic ducks the rest
  addEventListener(VOICE_PAUSE, () => { ptt = true; set({ mic: true }); }); // push-to-talk opened the mic
  addEventListener(VOICE_RESUME, () => { ptt = false; set({ mic: wake }); });
  addEventListener(WAKE_HEARING, (e) => { wake = !!(e as CustomEvent<{ on?: boolean }>).detail?.on; set({ mic: ptt || wake }); }); // "Hey Orbit" heard / armed
  onSpeakingChange((speaking) => set({ speaking }));
  const media = () => set({ media: !!getWatch()?.audible }); // the player says it is playing (a paused or errored video is quiet)
  subscribeWatch(media);
  set({ speaking: isSpeaking(), muted: readMute() });
  media();
}
