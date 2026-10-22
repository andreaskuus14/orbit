// NOAA / Meeus solar coordinates: https://gml.noaa.gov/grad/solcalc/calcdetails.html
const RAD = Math.PI / 180;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const wrap = (n: number) => ((n % 360) + 360) % 360;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

export type SunPosition = { azimuthDeg: number; elevationDeg: number };
export type SunSample = SunPosition & { time: Date };
export type DayArc = {
  positions: SunSample[];
  sunrise: Date | null;
  sunset: Date | null;
};

function validate(lat: number, lon: number, date: Date) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(date.getTime())) {
    throw new RangeError("Expected latitude ±90°, longitude ±180°, and a valid Date");
  }
}

function solarTerms(time: number) {
  const t = (time / DAY + 2440587.5 - 2451545) / 36525;
  const meanLong = wrap(280.46646 + t * (36000.76983 + 0.0003032 * t));
  const anomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + sin(2 * anomaly) * (0.019993 - 0.000101 * t) + sin(3 * anomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = meanLong + centre - 0.00569 - 0.00478 * sin(omega);
  const obliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - 0.001813 * t))) / 60) / 60 + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(apparentLong));
  const y = Math.tan(obliquity * RAD / 2) ** 2;
  const equationMinutes = 4 / RAD * (y * sin(2 * meanLong) - 2 * eccentricity * sin(anomaly)
    + 4 * eccentricity * y * sin(anomaly) * cos(2 * meanLong)
    - 0.5 * y * y * sin(4 * meanLong) - 1.25 * eccentricity ** 2 * sin(2 * anomaly));
  return { declination, equationMinutes };
}

/** Geometric centre of the sun (no atmospheric refraction). Longitude is east-positive; Date is an instant. */
export function sunPosition(lat: number, lon: number, date: Date): SunPosition {
  validate(lat, lon, date);
  const time = date.getTime();
  const { declination, equationMinutes } = solarTerms(time);
  const utcMinutes = ((time % DAY) + DAY) % DAY / MINUTE;
  const hourAngle = wrap((utcMinutes + equationMinutes + 4 * lon) / 4) - 180;
  const up = sin(lat) * Math.sin(declination) + cos(lat) * Math.cos(declination) * cos(hourAngle);
  const east = -Math.cos(declination) * sin(hourAngle);
  const north = cos(lat) * Math.sin(declination) - sin(lat) * Math.cos(declination) * cos(hourAngle);
  return {
    azimuthDeg: wrap(Math.atan2(east, north) / RAD),
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, up))) / RAD,
  };
}

/** Unit vector pointing toward the sun: +x east, +y up, -z north. */
export function sunDirection(lat: number, lon: number, date: Date): { x: number; y: number; z: number } {
  const { azimuthDeg: az, elevationDeg: el } = sunPosition(lat, lon, date);
  return { x: cos(el) * sin(az), y: sin(el), z: -cos(el) * cos(az) };
}

/**
 * The UTC calendar fields of day select a date at the supplied longitude (independent of host timezone).
 * Search its local mean-solar midnight-to-midnight interval, which may cross UTC date boundaries.
 * Sunrise/set use NOAA's -0.833° geometric horizon (refraction + solar radius).
 * Samples include both events and each elapsed hour after sunrise. Polar night returns no samples;
 * polar day samples the full interval hourly. Missing events are null, including transition days.
 */
export function dayArc(lat: number, lon: number, day: Date): DayArc {
  validate(lat, lon, day);
  const midnight = new Date(day);
  midnight.setUTCHours(0, 0, 0, 0);
  const start = midnight.getTime() - lon * 4 * MINUTE;
  const end = start + DAY;
  const height = (time: number) => sunPosition(lat, lon, new Date(time)).elevationDeg + 0.833;
  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let previous = height(start);
  // Minute brackets with bisection keep event accuracy independent of seasonal declination changes.
  for (let time = start + MINUTE; time <= end; time += MINUTE) {
    const current = height(time);
    if ((previous < 0) !== (current < 0)) {
      let lo = time - MINUTE, hi = time;
      const rising = previous < 0;
      while (hi - lo > 100) {
        const mid = (lo + hi) / 2;
        if ((height(mid) < 0) === rising) lo = mid;
        else hi = mid;
      }
      const event = new Date((lo + hi) / 2);
      if (rising) sunrise = event;
      else sunset = event;
    }
    previous = current;
  }
  const positions: SunSample[] = [];
  const sample = (time: number) => {
    const date = new Date(time);
    positions.push({ time: date, ...sunPosition(lat, lon, date) });
  };
  // Sample daylight segments separately if daylight crosses the interval boundary.
  const boundaries = [start, ...[sunrise, sunset].filter((d): d is Date => d !== null).map(d => d.getTime()).sort((a, b) => a - b), end];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i], to = boundaries[i + 1];
    if (height((from + to) / 2) < 0) continue;
    for (let time = from; time < to; time += HOUR) sample(time);
    sample(to);
  }
  return { positions, sunrise, sunset };
}
