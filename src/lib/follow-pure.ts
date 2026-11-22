// Follow the work (feat/ui-motion): when a request starts a job, ORBIT flies the galaxy camera to the planet doing it and
// opens the focused "Working on it" view. It never moves him while he types or reads: then (or with Follow off, or inside a
// world) it only shows a small "Jump to it" pill. Pure; tests in tests/ui-motion.test.ts.
import { shipTarget, type ShipTask } from "./ships-pure.ts";
import type { PlanetId } from "./planets.ts";
import { DUR } from "./ui-motion-pure.ts";

export const FOLLOW_KEY = "orbit.follow";
/** Typing or scrolling this recently counts as "busy reading": the view stays put. */
export const QUIET_MS = 4000;

/** Stored Follow setting: on unless he switched it off. */
export const followStored = (v: string | null | undefined) => v !== "0";

export type FollowCtx = {
  follow: boolean;          // the Follow toggle
  typing: boolean;          // focus is in a text field that has text in it
  lastInputMs: number;      // last key press / pointer down in a field (0 = never)
  lastScrollMs: number;     // last scroll of a reading surface (0 = never)
  nowMs: number;
  onHome: boolean;          // the galaxy / home is on screen (no world, no drawer)
  canFly: boolean;          // 3D galaxy, motion allowed, quality above minimum
};
/** fly: move the camera, then open the job · open: open the job directly (2D or reduced motion) · pill: show "Jump to it". */
export type FollowMove = "fly" | "open" | "pill";

export function followMove(c: FollowCtx): FollowMove {
  if (!c.follow || !c.onHome || c.typing) return "pill";
  const quiet = (t: number) => t > 0 && c.nowMs - t < QUIET_MS;
  if (quiet(c.lastInputMs) || quiet(c.lastScrollMs)) return "pill";
  return c.canFly ? "fly" : "open";
}

/** "Home" for following: the galaxy is on screen, or only the CORE chat sits over it (no world behind it). A job CORE starts
 *  from the chat flies there too; the chat closes as the camera leaves, like the demo. A world, another drawer or an open
 *  focused view still only gets the pill. */
export function followHome(s: { shown: string | null; panel: string | null; behind: string | null; busy: boolean }): boolean {
  if (s.shown || s.busy) return false;
  return !s.panel || (s.panel === "core" && !s.behind);
}

/** The planet a job belongs to (same rule as the agent ships: the planet its work concerns). */
export const followPlanet = (t: Pick<ShipTask, "title" | "agent" | "request">): PlanetId => shipTarget(t);

/** When the focused view starts to appear after a fly starts: it overlaps the camera's last stretch (follow-through),
 *  so the view is settling just as the camera does. Direct opens show at once. */
export const openDelay = (move: FollowMove) => (move === "fly" ? Math.round(DUR.fly * 0.72) : 0);

/** Jobs seen for the first time this session, oldest first: only those can start a follow (a reload never yanks). */
export function newJobs(seen: ReadonlySet<string>, running: readonly string[]): string[] {
  return running.filter((id) => !seen.has(id));
}

/** A job counts as "his request" when he asked for something this recently (a scheduled automation never pulls the view). */
export const REQUEST_WINDOW_MS = 90_000;
export const fromHisRequest = (lastRequestMs: number, nowMs: number) => lastRequestMs > 0 && nowMs - lastRequestMs >= 0 && nowMs - lastRequestMs < REQUEST_WINDOW_MS;
