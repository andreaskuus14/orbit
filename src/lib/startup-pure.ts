// Calm startup: which big surface may be on screen, and what "What's new" still has to say. No I/O. Tests: tests/startup.test.ts.
// One surface at a time, highest first: an urgent Herald alert, then the morning card, then the What's-new tour.
export const SURFACES = ["alert", "morning", "tour"] as const;
export type Surface = typeof SURFACES[number];
export const STARTUP_EVENT = "orbit:startup-surfaces"; // detail: Surface[] currently wanting the screen

/** true when no higher-priority surface currently wants the screen. */
export const isTurn = (s: Surface, wanting: readonly Surface[]) => !wanting.some((w) => SURFACES.indexOf(w) < SURFACES.indexOf(s));

export const KNOWN_KEY = "orbit.tour.known.v1"; // step ids the owner has already been told about (across TOUR_KEY bumps)
/** Step ids newer than what he has seen. Never seen anything (or a long gap): the top `max` and a "see all". */
export function newSince(all: readonly string[], known: readonly string[] | null, max = 5): { ids: string[]; more: boolean } {
  const fresh = known ? all.filter((id) => !known.includes(id)) : [...all];
  return { ids: fresh.slice(0, max), more: fresh.length > max };
}
export function parseKnown(raw: string | null): string[] | null {
  try { const j = JSON.parse(raw ?? "null"); return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : null; } catch { return null; }
}

/** Migrations the tour's "Run migrations" hint is about (only those with migration-guard markers can be checked). */
export const TOUR_MIGRATIONS = ["0019", "0020"];
/** Hide a setup hint unless the guard confirmed the migrations missing; unknown (null) hides too. */
export const showSetup = (setup: string, missing: readonly string[] | null) =>
  setup !== "migrations" || !!missing?.some((id) => TOUR_MIGRATIONS.includes(id));
