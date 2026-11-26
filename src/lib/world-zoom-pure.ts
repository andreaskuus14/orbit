// Semantic zoom for the planet worlds (v8): far out you see the whole world and its key counts; zoom in and the parts,
// then single items, get their labels. Pure: zoom level from camera distance, which chips show, where a click flies to.

/** 0 = whole world, 1 = parts (lanes, shelves, tiers, agent desks), 2 = single items (job, file, deal, memory). */
export type Lod = 0 | 1 | 2;

/** How far in the camera is, 0 (at max distance) .. 1 (at min distance). */
export function zoomIn(dist: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (max - dist) / (max - min)));
}

/** Zoom level from camera distance, with a small band so it does not flicker at a border. */
export function zoomLevel(dist: number, min: number, max: number, prev: Lod = 0): Lod {
  const z = zoomIn(dist, min, max), band = 0.03;
  const up1 = 0.38, up2 = 0.7; // borders between levels
  const at = (b: number, lvl: Lod) => (prev >= lvl ? z > b - band : z > b + band);
  return at(up2, 2) ? 2 : at(up1, 1) ? 1 : 0;
}

/**
 * Does a chip show? Overview chips (lod 0) show until you are down at single items; finer chips need the zoom level, and single items (lod 2) also
 * need to be near the camera, so zooming toward one area reveals that area's items only.
 * near: camera-to-anchor distance; reach: how close a single item must be (world units).
 */
export function chipShows(lod: Lod | undefined, level: Lod, near: number, reach: number): boolean {
  const l = lod ?? 0;
  if (l > level) return false;
  if (level - l >= 2) return false; // at item level the whole-world counts step aside (declutter)
  if (l === 2) return near <= reach;
  return true;
}

/** Overview chips step back (lower priority) once you are zoomed in, so item labels win the space. */
export function chipPrio(lod: Lod | undefined, level: Lod, prio: number): number {
  const l = lod ?? 0;
  return l === level ? prio + 100 : l < level ? prio - 50 * (level - l) : prio;
}

/** Where a click on a chip flies the camera: look at the item from a distance that shows the next level down. */
export function flyTo(lod: Lod | undefined, min: number, max: number): number {
  const l = lod ?? 0, span = max - min;
  // one level deeper than the clicked chip: overview -> parts (z ~ 0.55), parts -> items (z ~ 0.85), item -> close (min)
  const z = l === 0 ? 0.55 : l === 1 ? 0.85 : 0.93;
  return max - z * span;
}

/** Item reach for lod-2 chips: a share of the zoom range, never under the min distance. */
export const itemReach = (min: number, max: number) => Math.max(min * 1.6, min + (max - min) * 0.2);
