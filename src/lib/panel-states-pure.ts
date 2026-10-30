// V06/V08: explicit load states so a panel never shows a setup warning or a dead end while it is still checking.

/** INTELLIGENCE scheduled briefings. `scheduled` is undefined until /api/briefings answered. */
export type SchedState = "checking" | "configured" | "unconfigured" | "unavailable" | "error";
export function schedState(r: { scheduled?: boolean; failed?: "network" | "server" }): SchedState {
  if (r.failed === "network") return "unavailable";
  if (r.failed === "server") return "error";
  if (r.scheduled === undefined) return "checking";
  return r.scheduled ? "configured" : "unconfigured";
}

/** GAME DEV per-game views: what to show instead of the tool when no usable game is selected. */
export type PickState = "loading" | "failed" | "empty" | "none" | "unavailable" | "ready";
export function pickState(r: { loaded: boolean; loadErr?: string; games: { id: string }[]; selected: string | null }): PickState {
  if (!r.loaded) return r.loadErr ? "failed" : "loading";
  if (r.selected && r.games.some((g) => g.id === r.selected)) return "ready";
  if (r.selected) return "unavailable"; // picked game was deleted (e.g. in another tab)
  return r.games.length ? "none" : "empty";
}
