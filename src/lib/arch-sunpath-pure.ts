// Sun-path dome (architect's sun-path diagram in 3D). Positions come only from sun-pure; this file just samples and projects.
import { dayArc, sunPosition, type SunPosition } from "./sun-pure.ts";

export type Vec = [number, number, number];
export type DomeArc = { key: "summer" | "equinox" | "winter"; points: Vec[] };
const RAD = Math.PI / 180, MIN = 60_000, HOUR = 60 * MIN;

/** Point on a dome of radius r: +x east, +y up, -z north (same frame as sunDirection). */
export const domePoint = ({ azimuthDeg: az, elevationDeg: el }: SunPosition, r: number): Vec =>
  [r * Math.cos(el * RAD) * Math.sin(az * RAD), r * Math.sin(el * RAD), -r * Math.cos(el * RAD) * Math.cos(az * RAD)];

/** Sunrise-to-sunset arc: dayArc's own samples (hourly + rise/set) plus 15-min fill so the line reads as a curve. */
export function domeArc(lat: number, lon: number, day: Date, r: number, stepMin = 15): Vec[] {
  const ps = dayArc(lat, lon, day).positions;
  if (!ps.length) return []; // polar night
  const times = new Set(ps.map((p) => p.time.getTime()));
  for (let t = ps[0].time.getTime(); t < ps.at(-1)!.time.getTime(); t += stepMin * MIN) times.add(t);
  return [...times].sort((a, b) => a - b).map((t) => domePoint(sunPosition(lat, lon, new Date(t)), r));
}

// shortcut: fixed calendar dates (21 Jun, 20 Mar, 21 Dec), off by up to a day from the true solstice/equinox; fine at dome scale.
export function domeArcs(lat: number, lon: number, year: number, r: number): DomeArc[] {
  const d = (m: number, day: number) => new Date(Date.UTC(year, m, day, 12));
  return [
    { key: "summer", points: domeArc(lat, lon, d(5, 21), r) },
    { key: "equinox", points: domeArc(lat, lon, d(2, 20), r) },
    { key: "winter", points: domeArc(lat, lon, d(11, 21), r) },
  ];
}

/** Hour lines in local mean solar time: hour h on the 21st of Dec..Jun, above-horizon runs only. Flat [a,b,a,b...] for one segments draw. */
export function hourSegments(lat: number, lon: number, year: number, r: number): Vec[] {
  const out: Vec[] = [];
  for (let h = 0; h < 24; h++) {
    let prev: Vec | null = null;
    for (let m = -1; m <= 5; m++) { // Dec of the year before .. Jun
      const t = Date.UTC(year, m, 21) + h * HOUR - lon * 4 * MIN;
      const pos = sunPosition(lat, lon, new Date(t));
      const p = pos.elevationDeg >= 0 ? domePoint(pos, r) : null;
      if (p && prev) out.push(prev, p);
      prev = p;
    }
  }
  return out;
}
