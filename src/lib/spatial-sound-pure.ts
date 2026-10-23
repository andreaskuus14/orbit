// Audio targets only: no Three, Web Audio, components, clock or mutable state.
export type SoundVector = Readonly<{ x: number; y: number; z: number }>;
export type SoundCamera = Readonly<{
  position: SoundVector;
  // Camera-local → world quaternion, as in Three: identity looks down -Z, +X is right, +Y is up.
  orientation: Readonly<{ x: number; y: number; z: number; w: number }>;
}>;
export type SoundPlanet = Readonly<{ id: string; position: SoundVector }>;
export type SoundTarget = { pan: number; gain: number; lowpassHz: number };
export const SOUND_RANGE = 8; // scene units: gain is 1/4 at this distance
export const LOWPASS_NEAR_HZ = 20_000, LOWPASS_FAR_HZ = 400;
export const PING_ATTACK_SEC = 0.02, PING_DURATION_SEC = 0.6;
export const DRONE_MIN_GAIN = 0.025, DRONE_MAX_GAIN = 0.1;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finiteVector = (v: SoundVector) => [v.x, v.y, v.z].every(Number.isFinite);

/** Normalise before rotating +X. Degenerate/nonfinite orientations fall back to identity.
 * Scaling first avoids overflow/underflow even with very large/small quaternion components. */
function cameraRight(q: SoundCamera["orientation"]): SoundVector {
  const a = [q.x, q.y, q.z, q.w];
  const scale = Math.max(...a.map(Math.abs));
  if (!a.every(Number.isFinite) || scale === 0) return { x: 1, y: 0, z: 0 };
  const scaled = a.map((n) => n / scale), length = Math.hypot(...scaled);
  const [x, y, z, w] = scaled.map((n) => n / length);
  return { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
}

/** Pan is the unit source direction dotted with camera right. Front/back and directly above/below
 * are centred; distance affects gain/filter only. Invalid geometry is silent and centred.
 * Inverse-square falloff with a soft near field: 1/(1 + distance/8)^2, bounded in [0,1]. */
export function spatialTarget(camera: SoundCamera, position: SoundVector): SoundTarget {
  const silent = { pan: 0, gain: 0, lowpassHz: LOWPASS_FAR_HZ };
  if (!finiteVector(camera.position) || !finiteVector(position)) return silent;
  const d = { x: position.x - camera.position.x, y: position.y - camera.position.y, z: position.z - camera.position.z };
  if (!finiteVector(d)) return silent; // a subtraction of extreme finite coordinates can overflow
  const distance = Math.hypot(d.x, d.y, d.z), right = cameraRight(camera.orientation);
  const pan = distance > 0 ? clamp(d.x / distance * right.x + d.y / distance * right.y + d.z / distance * right.z, -1, 1) : 0;
  const gain = clamp(1 / (1 + distance / SOUND_RANGE) ** 2, 0, 1);
  return { pan, gain, lowpassHz: LOWPASS_FAR_HZ + (LOWPASS_NEAR_HZ - LOWPASS_FAR_HZ) * Math.sqrt(gain) };
}

/** A fresh target per planet ID (IDs must be unique). Inputs are never mutated. */
export function spatialSound(camera: SoundCamera, planets: readonly SoundPlanet[]): Record<string, SoundTarget> {
  return Object.fromEntries(planets.map((p) => [p.id, spatialTarget(camera, p.position)]));
}

/** Linear 20 ms attack followed by a squared release, ending exactly at 600 ms.
 * elapsedSec is caller-supplied time since the event; before/after the ping or invalid time is silent. */
export function pingEnvelope(elapsedSec: number): number {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || elapsedSec >= PING_DURATION_SEC) return 0;
  if (elapsedSec < PING_ATTACK_SEC) return elapsedSec / PING_ATTACK_SEC;
  return ((PING_DURATION_SEC - elapsedSec) / (PING_DURATION_SEC - PING_ATTACK_SEC)) ** 2;
}

/** An event uses its emitting planet's pan/filter; only its gain follows the envelope. */
export function planetPing(camera: SoundCamera, planet: SoundPlanet, elapsedSec: number): SoundTarget {
  const target = spatialTarget(camera, planet.position);
  return { ...target, gain: target.gain * pingEnvelope(elapsedSec) };
}

/** CORE breath is a normalised 0..1 value (exhale..inhale). Steady quiet floor, bounded peak.
 * No smoothing/oscillator here: callers provide the current breath, invalid values use the quiet floor. */
export function droneLevel(breath: number): number {
  return DRONE_MIN_GAIN + (DRONE_MAX_GAIN - DRONE_MIN_GAIN) * (Number.isFinite(breath) ? clamp(breath, 0, 1) : 0);
}
