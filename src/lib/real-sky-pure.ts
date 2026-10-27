// "Real sky" (pure, tested in tests/real-sky.test.ts): the galaxy's backdrop follows the real sky at his place. Colours for the
// existing background and fog, the sun as a faint directional light, the moon's spot and phase, and a seasonal star density.
// Galaxy axes match sun-pure's sunDirection: +x east, +y up (the galaxy's normal), −z north.
import { dayNight } from "./daynight-pure.ts";
import { sunPosition } from "./sun-pure.ts";
import { moonSky } from "./moon-pure.ts";

export const SKY_BG = "#000003", SKY_FOG = "#010208"; // Galaxy's own colours: what "off" restores
export const SKY_HOME = { lat: 59.437, lon: 24.754 }; // Tallinn
const WARM = "#3a1a0c", SUN_LOW = "#ffb27a", SUN_HIGH = "#fff4e6";
export type Vec = { x: number; y: number; z: number };
export type RealSky = {
  bg: string; fog: string;
  sun: { dir: Vec; intensity: number; color: string };
  moon: { dir: Vec; up: boolean; illumination: number; waxing: boolean };
  stars: number; // 0.5 (white nights) – 1 (long winter nights): a factor on the star count, never more than today
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const blend = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");
const RAD = Math.PI / 180;
const dir = (azimuthDeg: number, elevationDeg: number): Vec => {
  const az = azimuthDeg * RAD, el = elevationDeg * RAD;
  return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
};

/** Hours of real darkness (sun below −6°, civil twilight) in the 24 h from the UTC day's start: sampled hourly, poles included. */
export function darkHours(lat: number, lon: number, date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let n = 0;
  for (let h = 0; h < 24; h++) if (sunPosition(lat, lon, new Date(day + h * 3_600_000 + 1_800_000)).elevationDeg < -6) n++;
  return n;
}

/** Star-count factor: 0.5 (white nights) – 1 (16 h+ of darkness), never more than the galaxy draws today. */
export const starDensity = (lat: number, lon: number, date: Date) => 0.5 + 0.5 * Math.min(1, darkHours(lat, lon, date) / 16);

/** The sky at (lat, lon) at this instant. Bad coordinates fall back to Tallinn. */
export function realSky(date: Date, lat: number = SKY_HOME.lat, lon: number = SKY_HOME.lon): RealSky {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) ({ lat, lon } = SKY_HOME);
  const dn = dayNight(date, { latitude: lat, longitude: lon });
  const el = dn.elevationDeg;
  const twilight = clamp01(1 - Math.abs(el + 3) / 9); // peaks with the sun 3° under the horizon: dawn and dusk
  const m = moonSky(lat, lon, date);
  return {
    // night stays the deep void; daylight lifts it a breath toward the real sky's colour
    bg: blend(SKY_BG, dn.palette.sky, 0.25 * dn.lightFactor),
    // the far haze (the galaxy's edge) warms at dawn and dusk
    fog: blend(blend(SKY_FOG, dn.palette.ambient, 0.3 * dn.lightFactor), WARM, 0.7 * twilight),
    sun: { dir: dir(dn.azimuthDeg, el), intensity: 0.18 * dn.lightFactor, color: blend(SUN_LOW, SUN_HIGH, clamp01(el / 20)) },
    moon: { dir: dir(m.azimuthDeg, m.elevationDeg), up: m.elevationDeg > -0.5, illumination: m.illumination, waxing: m.waxing },
    stars: starDensity(lat, lon, date),
  };
}
