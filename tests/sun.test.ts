import { test } from "node:test";
import assert from "node:assert/strict";
import { dayArc, sunDirection, sunPosition } from "../src/lib/sun-pure.ts";

const LAT = 59.437, LON = 24.754;
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);

// Published Tallinn 2025 tables, converted to UTC (Stjerneskinn uses standard EET = UTC+2):
// https://stjerneskinn.com/sunrise-world-tallinn-new.htm
// https://web-calendar.org/en/world/europe/estonia/tallinn?menu=sun&month=12&year=2025
// Solstice noon geometric elevation = 90 - latitude ± Earth's 23.44° axial tilt.
for (const ref of [
  { day: "2025-06-21", noon: "10:23", elevation: 54.00, rise: "01:03", set: "19:42" },
  { day: "2025-12-21", noon: "10:19", elevation: 7.12, rise: "07:18", set: "13:20" },
]) {
  test(`Tallinn ${ref.day}: solstice noon and published sunrise/sunset`, () => {
    const date = (time: string) => new Date(`${ref.day}T${time}:00Z`);
    const noon = sunPosition(LAT, LON, date(ref.noon));
    near(noon.elevationDeg, ref.elevation, 0.5);
    near(noon.azimuthDeg, 180, 0.5);
    const arc = dayArc(LAT, LON, date("00:00"));
    assert.ok(arc.sunrise && arc.sunset);
    near(arc.sunrise.getTime(), date(ref.rise).getTime(), 5 * 60_000);
    near(arc.sunset.getTime(), date(ref.set).getTime(), 5 * 60_000);
    assert.deepEqual(arc.positions[0].time, arc.sunrise);
    assert.deepEqual(arc.positions.at(-1)!.time, arc.sunset);
    near(arc.positions[0].elevationDeg, -0.833, 0.001);
    near(arc.positions.at(-1)!.elevationDeg, -0.833, 0.001);
    for (let i = 1; i < arc.positions.length; i++) {
      const delta = arc.positions[i].time.getTime() - arc.positions[i - 1].time.getTime();
      assert.ok(delta > 0 && delta <= 3_600_000);
      if (i < arc.positions.length - 1) assert.equal(delta, 3_600_000);
    }
    for (const sample of arc.positions) {
      const { x, y, z } = sunDirection(LAT, LON, sample.time);
      near(Math.hypot(x, y, z), 1, 1e-12);
      near(y, Math.sin(sample.elevationDeg * Math.PI / 180), 1e-12);
      assert.ok(sample.azimuthDeg >= 0 && sample.azimuthDeg < 360);
    }
    assert.ok(sunDirection(LAT, LON, date(ref.noon)).z > 0); // south = +z
    assert.ok(sunDirection(LAT, LON, arc.sunrise).x > 0); // east = +x
    assert.ok(sunDirection(LAT, LON, arc.sunset).x < 0); // west = -x
  });
}

test("polar day/night have null events and finite, ordered daylight samples", () => {
  const summer = dayArc(90, 0, new Date("2025-06-21"));
  assert.equal(summer.sunrise, null);
  assert.equal(summer.sunset, null);
  assert.equal(summer.positions.length, 25);
  assert.ok(summer.positions.every(p => Number.isFinite(p.azimuthDeg) && p.elevationDeg > 0));
  assert.deepEqual(dayArc(90, 0, new Date("2025-12-21")), { positions: [], sunrise: null, sunset: null });
});

test("UTC date selection ignores time of day and longitude can cross UTC midnight", () => {
  assert.deepEqual(dayArc(LAT, LON, new Date("2025-06-21T23:59:00Z")), dayArc(LAT, LON, new Date("2025-06-21")));
  const east = dayArc(0, 180, new Date("2025-03-20"));
  const west = dayArc(0, -180, new Date("2025-03-20"));
  assert.ok(east.sunrise && west.sunrise);
  assert.equal(east.sunrise.toISOString().slice(0, 10), "2025-03-19");
  assert.equal(west.sunrise.toISOString().slice(0, 10), "2025-03-20");
});

test("invalid coordinates and dates are rejected by every public function", () => {
  for (const fn of [sunPosition, sunDirection, dayArc]) {
    for (const [lat, lon, date] of [
      [91, 0, new Date()], [0, -181, new Date()], [NaN, 0, new Date()],
      [0, Infinity, new Date()], [0, 0, new Date(NaN)],
    ] as const) assert.throws(() => fn(lat, lon, date), RangeError);
  }
});

// Independent reference: NOAA "General Solar Position Calculations" (Spencer Fourier series, a different method from the
// Meeus series in sun-pure): https://gml.noaa.gov/grad/solcalc/solareqns.PDF. Azimuth clockwise from north,
// cos(az) = (sin δ − sin φ_lat cos θz) / (cos φ_lat sin θz), mirrored for afternoon (hour angle > 0).
// Deliberately not the PDF's literal cos(180 − θ) form: as printed it gives 0° (north) at solar noon; this is the same
// spherical-triangle relation rearranged to give azimuth clockwise from north directly.
function noaaGeneral(lat: number, lon: number, date: Date) {
  const r = Math.PI / 180, doy = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000 + 1;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (Math.floor(doy) - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((((hour * 60 + eqtime + 4 * lon) / 4) % 360) + 360) % 360 - 180, la = lat * r;
  const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha * r), z = Math.acos(cz);
  const a = Math.acos(Math.max(-1, Math.min(1, (Math.sin(decl) - Math.sin(la) * cz) / (Math.cos(la) * Math.sin(z))))) / r;
  return { elevationDeg: 90 - z / r, azimuthDeg: ha > 0 ? 360 - a : a };
}
// Local clock 9:00 and 12:00 on both solstices, with each city's legal UTC offset that day (DST where it applies).
for (const c of [
  { name: "Tallinn", lat: 59.437, lon: 24.754, jun: 3, dec: 2 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, jun: 10, dec: 11 },
  { name: "New York", lat: 40.7128, lon: -74.006, jun: -4, dec: -5 },
]) for (const [day, off] of [["2025-06-21", c.jun], ["2025-12-21", c.dec]] as const) for (const clock of [9, 12]) {
  test(`${c.name} ${day} ${clock}:00 local matches NOAA general solar position within 0.5°`, () => {
    const at = new Date(Date.parse(`${day}T00:00:00Z`) + (clock - off) * 3_600_000);
    const got = sunPosition(c.lat, c.lon, at), ref = noaaGeneral(c.lat, c.lon, at);
    near(got.elevationDeg, ref.elevationDeg, 0.5);
    near(((got.azimuthDeg - ref.azimuthDeg + 540) % 360) - 180, 0, 0.5);
  });
}
