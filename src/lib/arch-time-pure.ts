// ARCH time machine (pure, tested in tests/arch-time.test.ts): the model's version history (last KEEP saved states, kept in the
// data dir by arch-time.ts) and the shadow a sun position casts, for the sun study in the 3D view.
import type { Scene } from "./arch-pure.ts";

export const KEEP = 60;
export type Snapshot = { at: string; scene: Scene };

const isScene = (s: unknown): s is Scene => {
  const o = s as Scene | null;
  return !!o && typeof o === "object" && !!o.plot && typeof o.plot === "object" && Array.isArray(o.parts) && JSON.stringify(o).length <= 20_000;
};

/** The history file's content → valid snapshots, oldest first (bad entries dropped). */
export function readSnapshots(raw: unknown): Snapshot[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((x): x is Snapshot => !!x && typeof x.at === "string" && Number.isFinite(Date.parse(x.at)) && isScene(x.scene)).slice(-KEEP);
}

/** Append a saved state unless it equals the newest one; keep the last `keep`. null = not a scene. */
export function pushSnapshot(list: Snapshot[], scene: unknown, at: Date, keep = KEEP): Snapshot[] | null {
  if (!isScene(scene)) return null;
  if (list.length && JSON.stringify(list[list.length - 1].scene) === JSON.stringify(scene)) return list;
  return [...list, { at: at.toISOString(), scene }].slice(-keep);
}

/** Shadow of a vertical edge `height` m tall on flat ground. Plot axes as in sun-pure: +x east, −z north.
 *  It points away from the sun (azimuth + 180°). null when the sun is at or below the horizon. Capped at `cap` m. */
export function shadowOf(sun: { azimuthDeg: number; elevationDeg: number }, height: number, cap = 200): { length: number; towardDeg: number; dx: number; dz: number } | null {
  if (!(sun.elevationDeg > 0) || !(height > 0)) return null;
  const length = Math.min(cap, height / Math.tan((sun.elevationDeg * Math.PI) / 180));
  const towardDeg = (sun.azimuthDeg + 180) % 360, a = (towardDeg * Math.PI) / 180;
  return { length, towardDeg, dx: Math.sin(a) * length, dz: -Math.cos(a) * length };
}
