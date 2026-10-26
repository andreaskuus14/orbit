// Living events: which backend event makes which effect in the galaxy, and a fixed pool of effect slots that coalesces
// bursts and caps how many play at once. The spatial-audio branch maps the same events to sounds in its own file.

export type EffectKind = "comet" | "aurora" | "flare" | "sunrise";
export type Effect = { kind: EffectKind; at: string }; // at: the planet it plays on ("core" for the galaxy-wide sunrise)

/** The effect an `events` row should make, or null. */
export function effectFor(type: string, planet: string): Effect | null {
  if (type === "agent.completed") return { kind: "comet", at: planet || "agents" }; // streaks from that planet to the CORE
  if (type === "clip.published") return { kind: "aurora", at: "studio" };
  if (type === "deal.found") return { kind: "flare", at: "markets" };
  if (type === "night.end") return { kind: "sunrise", at: "core" };
  return null;
}

export const DURATION: Record<EffectKind, number> = { comet: 1600, aurora: 2600, flare: 1800, sunrise: 9000 }; // ms
export const CAP = 6;
export const COALESCE_MS = 1500; // the same effect on the same planet again this soon only brightens the one playing
export const MAX_BOOST = 3;

export type Slot = { kind: EffectKind | null; at: string; start: number; boost: number };
export const newPool = (n = CAP): Slot[] => Array.from({ length: n }, () => ({ kind: null, at: "", start: 0, boost: 1 }));

/** 0..1 through the slot's effect; a finished slot is freed and returns -1. */
export function progress(s: Slot, now: number): number {
  if (!s.kind) return -1;
  const k = (now - s.start) / DURATION[s.kind];
  if (k >= 1 || k < 0) { s.kind = null; return -1; }
  return k;
}

/** Puts `e` in the pool in place (no allocation). Returns what happened, for tests. A full pool drops the event:
 *  cutting a playing effect short reads as a glitch, a missed one does not. */
export function admit(pool: Slot[], e: Effect, now: number): "coalesced" | "added" | "dropped" {
  let free = -1;
  for (let i = 0; i < pool.length; i++) {
    const s = pool[i];
    if (progress(s, now) < 0) { if (free < 0) free = i; continue; }
    if (s.kind === e.kind && s.at === e.at && now - s.start < COALESCE_MS) { s.boost = Math.min(MAX_BOOST, s.boost + 1); return "coalesced"; }
  }
  if (free < 0) return "dropped";
  const s = pool[free];
  s.kind = e.kind; s.at = e.at; s.start = now; s.boost = 1;
  return "added";
}

/** Effects only when they cost nothing the owner would notice: motion allowed, tab visible, not on the lowest quality
 *  level, and frames currently on budget (smoothed frame time under ~45 fps). */
export function allowed(o: { reduced: boolean; hidden: boolean; level: number; frameMs: number }): boolean {
  return !o.reduced && !o.hidden && o.level > 0 && o.frameMs < 1000 / 45;
}

/** Window event Orbit fires for each `events` row (detail: { type, planet }); the galaxy's LivingEffects listens. */
export const LIVING_EVENT = "orbit:living";
