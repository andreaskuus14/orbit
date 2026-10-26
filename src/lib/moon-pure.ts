// Moon position and phase, low precision. Jean Meeus, "Astronomical Algorithms" (2nd ed., 1998): ch. 47 (the largest terms of
// the ELP-2000/82 series, Tables 47.A/47.B) and ch. 48 (phase angle, eq. 48.4). Truncated to the terms above 0.004°: ~0.05°
// in longitude, far below the moon's 0.5° disc. Tested against Meeus's worked examples 47.a / 48.a and USNO phase times.
// shortcut: geocentric (no ~1° topocentric parallax), no nutation or ΔT; add them if this ever aims a telescope.
const RAD = Math.PI / 180;
const wrap = (n: number) => ((n % 360) + 360) % 360;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

export type MoonSky = {
  azimuthDeg: number; elevationDeg: number; // north = 0°, clockwise; geometric centre
  lonDeg: number; latDeg: number;           // geocentric ecliptic longitude / latitude
  illumination: number;                     // illuminated fraction of the disc, 0 (new) – 1 (full)
  waxing: boolean;
};

// [D, M, M', F, coefficient in 1e-6°]
const LON: [number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314], [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332], [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322], [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720], [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034], [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766], [1, 0, -1, 0, -5163],
];
const LAT: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200],
];

/** Julian day of an instant. */
export const julianDay = (date: Date) => date.getTime() / 86_400_000 + 2440587.5;

/** Where the moon is in his sky and how much of it is lit. Longitude east-positive; Date is an instant. */
export function moonSky(lat: number, lon: number, date: Date): MoonSky {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(date.getTime())) {
    throw new RangeError("Expected latitude ±90°, longitude ±180°, and a valid Date");
  }
  const jd = julianDay(date), t = (jd - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * t;
  const D = 297.8501921 + 445267.1114034 * t;
  const M = 357.5291092 + 35999.0502909 * t;
  const Mp = 134.9633964 + 477198.8675055 * t;
  const F = 93.2720950 + 483202.0175233 * t;
  const E = 1 - 0.002516 * t; // the sun's eccentricity shrinks: terms with M scale by E per power
  const sum = (rows: typeof LON, f: (x: number) => number) =>
    rows.reduce((s, [d, m, mp, ff, c]) => s + c * E ** Math.abs(m) * f(d * D + m * M + mp * Mp + ff * F), 0) / 1e6;
  const lonDeg = wrap(Lp + sum(LON, sin)), latDeg = sum(LAT, sin);
  // ecliptic → equatorial → horizontal
  const eps = 23.439291 - 0.0130042 * t;
  const ra = Math.atan2(sin(lonDeg) * cos(eps) - Math.tan(latDeg * RAD) * sin(eps), cos(lonDeg)) / RAD;
  const dec = Math.asin(sin(latDeg) * cos(eps) + cos(latDeg) * sin(eps) * sin(lonDeg)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545); // Meeus eq. 12.4 (T² terms < 0.001°)
  const H = gmst + lon - ra;
  const up = sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H);
  const east = -cos(dec) * sin(H), north = cos(lat) * sin(dec) - sin(lat) * cos(dec) * cos(H);
  // phase angle, eq. 48.4
  const i = 180 - D - 6.289 * sin(Mp) + 2.1 * sin(M) - 1.274 * sin(2 * D - Mp) - 0.658 * sin(2 * D) - 0.214 * sin(2 * Mp) - 0.11 * sin(D);
  return {
    azimuthDeg: wrap(Math.atan2(east, north) / RAD),
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, up))) / RAD,
    lonDeg, latDeg,
    illumination: (1 + cos(i)) / 2,
    waxing: wrap(D) < 180, // elongation east of the sun: growing
  };
}
