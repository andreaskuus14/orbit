// News weather → the flythrough as one state machine: rest ⇄ tour ⇄ flying home. The app (NewsWeatherLayer.tsx) and the motion
// test (scripts/news-weather-motion-test.mjs) both read frameAt(), so the video shows exactly what ships. Tests: tests/news-weather.test.ts.
import { stopAt, type PlanStop, type Stop } from "./news-weather-pure.ts";
import { backView, PRESS, restScene, stopScene, type RestScene, type StopScene, type View } from "./news-weather-motion-pure.ts";

export type Ctl = { mode: "rest" | "tour" | "back"; pressAt: number; backAt: number; backFrom: View | null; paused: boolean };
export const CTL0: Ctl = { mode: "rest", pressAt: -1, backAt: -1, backFrom: null, paused: false };
export type Ctx = { rest: View; views: View[]; stops: Stop[]; plan: PlanStop[]; reduced: boolean };
export type Frame = { view: View; rest: RestScene; i: number; scene: StopScene | null; from: [number, number]; done: boolean };

/** `now` = real ms (press/back animations); `clock` = tour ms (the audio's time, or our own clock without audio), starting at 0
 *  PRESS.tour ms after the press. */
export function frameAt(c: Ctl, now: number, clock: number, x: Ctx): Frame {
  const restF = (r: RestScene, view: View = x.rest): Frame => ({ view, rest: r, i: -1, scene: null, from: [x.rest.lon, x.rest.lat], done: false });
  if (c.mode === "back" && c.backFrom) {
    const t = now - c.backAt;
    return restF(restScene(0, x.reduced, Math.max(1, t)), backView(c.backFrom, x.rest, t, x.reduced));
  }
  if (c.mode !== "tour" || !x.stops.length) return restF(restScene(-1));
  const r = restScene(now - c.pressAt, x.reduced);
  if (clock < 0) return restF(r);
  const { i, local } = stopAt(x.plan, clock);
  if (i >= x.stops.length) { const last = x.stops.length - 1; return { view: x.views[last], rest: r, i: last, scene: stopScene(1e9, x.views[last], x.views[last], x.stops[last].beams.length, 1e9, x.reduced), from: [x.rest.lon, x.rest.lat], done: true }; }
  const from = i ? x.views[i - 1] : x.rest, p = x.plan[i];
  const scene = stopScene(local, from, x.views[i], x.stops[i].beams.length, p.end - p.start, x.reduced);
  const prevSys = i ? x.stops[i - 1].system : null;
  return { view: scene.view, rest: r, i, scene, from: prevSys ? [prevSys.lon, prevSys.lat] : [x.rest.lon, x.rest.lat], done: false };
}

/** Keys: Space pause/resume, → next story, Esc back to the weather. Returns what to do (the caller owns audio + clock). */
export function keyAction(key: string, mode: Ctl["mode"]): "pause" | "next" | "back" | "play" | null {
  if (mode === "tour") return key === " " || key === "Spacebar" ? "pause" : key === "ArrowRight" ? "next" : key === "Escape" ? "back" : null;
  return null;
}
/** Where → jumps to: the next stop's start, or the end (which flies home). */
export const nextClock = (plan: PlanStop[], clock: number) => { const { i } = stopAt(plan, clock); return i + 1 < plan.length ? plan[i + 1].start : (plan[plan.length - 1]?.end ?? 0); };
export const tourStartDelay = PRESS.tour;
