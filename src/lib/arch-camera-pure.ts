// ARCH opening shot (pure, tested in tests/arch-camera.test.ts): a three-quarter view with a 40 mm lens on a 24 mm tall frame, from the
// south-east a little above eye level, far enough that the whole house sits in the free part of the screen (left of the panel).
type V3 = [number, number, number];
export type Box = { min: V3; max: V3 };
export const LENS_MM = 40, FRAME_MM = 24;
/** Vertical field of view (degrees) of a lens on a frame this tall. 40 mm on 24 mm = 33.4 degrees. */
export const fovOf = (lens = LENS_MM, frame = FRAME_MM) => (2 * Math.atan(frame / 2 / lens) * 180) / Math.PI;

/** Bounding box of the model's parts (metres); null when there is nothing to frame. */
export function partsBox(parts: { kind: string; x: number; y: number; z: number; w: number; d: number; h: number }[]): Box | null {
  const p = parts.filter((q) => q.kind !== "prop" && [q.x, q.y, q.z, q.w, q.d, q.h].every(Number.isFinite));
  if (!p.length) return null;
  return { min: [Math.min(...p.map((q) => q.x - q.w / 2)), Math.min(...p.map((q) => q.y)), Math.min(...p.map((q) => q.z - q.d / 2))],
    max: [Math.max(...p.map((q) => q.x + q.w / 2)), Math.max(...p.map((q) => q.y + q.h)), Math.max(...p.map((q) => q.z + q.d / 2))] };
}

export type Shot = { position: V3; target: V3; fov: number; distance: number };
/** aspect = canvas width / height; panel = fraction of the width the side panel covers (0 on narrow screens). Azimuth 0 = from the south,
 *  positive swings towards the east; elevation in degrees. */
export function homeShot(b: Box, aspect: number, panel = 0, azimuthDeg = 38, elevationDeg = 15): Shot {
  const c: V3 = [(b.min[0] + b.max[0]) / 2, b.min[1] + (b.max[1] - b.min[1]) * 0.42, (b.min[2] + b.max[2]) / 2];
  const R = Math.max(2, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
  const fov = fovOf(), v = (fov * Math.PI) / 360, h = Math.atan(Math.tan(v) * Math.max(0.5, aspect * (1 - panel)));
  const dist = (R * 0.98) / Math.sin(Math.min(v, h)); // the bounding sphere just fits the smaller of the two half-angles (a house is not a sphere: the corners have room)
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  const position: V3 = [c[0] + Math.sin(az) * Math.cos(el) * dist, c[1] + Math.sin(el) * dist, c[2] + Math.cos(az) * Math.cos(el) * dist];
  return { position, target: c, fov, distance: dist };
}

/** The opening shot's angles, shared with the site so nothing is planted in front of the camera. */
export const SHOT = { azimuth: 38, elevation: 15 };
/** Direction of the default camera as seen from the house, as atan2(z, x). */
export const shotSector = (azimuthDeg = SHOT.azimuth) => Math.atan2(Math.cos((azimuthDeg * Math.PI) / 180), Math.sin((azimuthDeg * Math.PI) / 180));
