// Spatial ambient sound (roadmap E6): pure mapping, coalescing and mixing rules. No Web Audio, clock or storage here;
// the engine (components/spatial-audio.ts) applies them. Tested in tests/ambient-sound.test.ts.
export const AMBIENT_KEY = "orbit.ambient"; // "1" = on. Off by default: nothing plays until he enables "Ambient sound".
export const VOLUME_KEY = "orbit.ambient.volume";
export const DAWN_KEY = "orbit.ambient.dawn"; // endedAt of the last night shift that already got its dawn swell
export const DEFAULT_VOLUME = 0.5;
export const QUIET_SCALE = 0.4; // 23:00–08:00
export const HUM_STOPPED = 0.15; // Stop-all: the CORE hum drops to this share
export const CHIME_GAP_MS = 8_000; // one planet: a burst within 8 s is one chime
export const ANY_GAP_MS = 1_500; // all planets: at most one chime per 1.5 s

export type Cue = { source: string; kind: "chime" | "dawn" };

/** A realtime `events` row → the sound it makes, or null for silence. */
export function cueFor(type: string, payload?: { status?: unknown } | null): Cue | null {
  switch (type) {
    case "clip.published": return { source: "studio", kind: "chime" };
    case "agent.completed": return payload?.status === "cancelled" ? null : { source: "agents", kind: "chime" };
    case "deal.found": return { source: "markets", kind: "chime" };
    case "night.end": return { source: "core", kind: "dawn" };
    default: return null;
  }
}

export type Coalesce = { last: Readonly<Record<string, number>>; any: number };
export const COALESCE_START: Coalesce = { last: {}, any: -Infinity };

/** Should this cue play at `now` (ms)? Dawn always plays. Dropped cues don't extend the window, so a steady
 * trickle still chimes every CHIME_GAP_MS instead of going silent. */
export function admit(s: Coalesce, cue: Cue, now: number): { play: boolean; state: Coalesce } {
  const play = cue.kind === "dawn" || (now - (s.last[cue.source] ?? -Infinity) >= CHIME_GAP_MS && now - s.any >= ANY_GAP_MS);
  return { play, state: play ? { last: { ...s.last, [cue.source]: now }, any: now } : s };
}

export const quietHours = (hour: number) => hour >= 23 || hour < 8;

export type MixInput = { enabled: boolean; volume: number; hidden: boolean; hour: number; stopAll: boolean };
/** master: overall gain 0..1; hum: CORE hum share. A hidden tab and the off switch are silent. */
export function mix(i: MixInput): { master: number; hum: number } {
  const v = Number.isFinite(i.volume) ? Math.max(0, Math.min(1, i.volume)) : DEFAULT_VOLUME;
  return { master: !i.enabled || i.hidden ? 0 : v * (quietHours(i.hour) ? QUIET_SCALE : 1), hum: i.stopAll ? HUM_STOPPED : 1 };
}

export function parseVolume(raw: string | null): number {
  const v = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOLUME;
}

/** A night shift that ended after the last dawn swell (and parses) gets one on open. */
export function dawnDue(endedAt: string | undefined | null, seen: string | null): boolean {
  const t = Date.parse(endedAt ?? "");
  return Number.isFinite(t) && (seen === null || !(Date.parse(seen) >= t));
}

// Minor pentatonic over A2: calm against itself whatever planets you hear together.
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29];
export const HUM_HZ = 55;

/** Drone for the planet at orbit index i of n: inner planets sit higher, outer ones lower; each breathes on its own slow LFO. */
export function voiceFor(i: number, n: number): { hz: number; fifth: number; lfoHz: number; gain: number } {
  const step = PENTA[Math.max(0, Math.min(PENTA.length - 1, n - 1 - i))];
  const hz = 110 * 2 ** (step / 12);
  return { hz, fifth: hz * 1.5 * 1.003, lfoHz: 0.03 + 0.011 * i, gain: 0.05 };
}
