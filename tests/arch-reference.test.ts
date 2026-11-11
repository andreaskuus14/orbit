// G01 reference house + G05 daylight reference matrix. Expected numbers are worked out by hand in the comments, never read back
// from the code under test. The sun is compared against an independent re-implementation of the NOAA spreadsheet below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REF, referenceHouse } from "../src/lib/arch-reference-pure.ts";
import { applyOps, boq, isOpening, OPENING, RULES, type Part } from "../src/lib/arch-pure.ts";
import { siteStats, defaultSite, toModel } from "../src/lib/arch-site-pure.ts";
import { toIfc } from "../src/lib/arch-ifc-pure.ts";
import { shadowOf, siteInstant } from "../src/lib/arch-time-pure.ts";
import { sunDirection, sunPosition } from "../src/lib/sun-pure.ts";

const near = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (±${tol})`);
const get = (ps: Part[], id: string) => ps.find((p) => p.id === id)!;
const top = (p: Part) => p.y + p.h;

/* ---------------- G01: reference house ---------------- */

test("G01 house: floor levels stack at exactly 3.0 m floor-to-floor, roof sits on the top wall", () => {
  const ps = referenceHouse().parts;
  assert.equal(ps.length, 10);
  near(top(get(ps, "r-found")), 0, 1e-9, "foundation top = ground");
  near(get(ps, "r-walls1").y, top(get(ps, "r-slab1")), 1e-9, "walls 1 on slab 1");
  near(get(ps, "r-slab2").y, top(get(ps, "r-walls1")), 1e-9, "slab 2 on walls 1");
  near(get(ps, "r-walls2").y, top(get(ps, "r-slab2")), 1e-9, "walls 2 on slab 2");
  near(get(ps, "r-roof").y, top(get(ps, "r-walls2")), 1e-9, "roof on walls 2");
  near(top(get(ps, "r-slab2")) - top(get(ps, "r-slab1")), REF.floorToFloor, 1e-9, "finished floor to finished floor");
  near(top(get(ps, "r-roof")), 8.0, 1e-9, "ridge = 2 × 3.0 + 2.0");
  // clear room height: wall height (the slab above sits on the wall top)
  near(get(ps, "r-slab2").y - top(get(ps, "r-slab1")), 2.8, 1e-9, "clear height floor 1");
});

test("G01 house: openings keep their stated size/sill and stay inside their host wall face", () => {
  const ps = referenceHouse().parts;
  // s face is z = +d/2 = +4; n face z = −4; e face x = +5. y = wall base + sill.
  const want: Record<string, { w: number; h: number; sill: number; x: number; y: number; z: number }> = {
    "r-door": { w: 1.0, h: 2.1, sill: 0, x: 0, y: 0.2, z: 4 },
    "r-win1": { w: 1.2, h: 1.2, sill: 0.9, x: 3, y: 1.1, z: 4 },
    "r-win2": { w: 2.4, h: 1.2, sill: 0.9, x: -2, y: 4.1, z: -4 },
    "r-win3": { w: 0.6, h: 1.6, sill: 0.6, x: 5, y: 3.8, z: 1 },
  };
  for (const [id, e] of Object.entries(want)) {
    const o = get(ps, id), wall = get(ps, o.host!);
    for (const k of ["w", "h", "sill", "x", "y", "z"] as const) near(o[k]!, e[k], 1e-9, `${id}.${k}`);
    // inside the face: corner margin each side, lintel left above, bottom not below the wall base
    const ns = o.face === "n" || o.face === "s", len = ns ? wall.w : wall.d, off = o.off!;
    assert.ok(Math.abs(off) + o.w / 2 <= len / 2 - OPENING.margin + 1e-9, `${id} within face length`);
    assert.ok(o.y >= wall.y - 1e-9 && o.y + o.h <= top(wall) - OPENING.lintel + 1e-9, `${id} within wall height`);
  }
});

test("G01 house: quantities in m / m² / m³ match hand arithmetic", () => {
  const q = boq(referenceHouse().parts);
  // shell centreline perimeter 2(10+8) − 4·0.3 = 34.8 m; × 2.8 m × 2 floors = 194.88 m² gross wall face
  // openings 1.0·2.1 + 1.2·1.2 + 2.4·1.2 + 0.6·1.6 = 2.10 + 1.44 + 2.88 + 0.96 = 7.38 m² → net 187.50 m²
  near(q.wallM2, 187.5, 0.005, "net wall face");
  near(q.wallM3, (194.88 - 7.38) * RULES.wallThick, 0.005, "wall volume 56.25 m³");
  near(q.windowM2, 5.28, 0.005, "glazed area");
  assert.equal(q.windows, 3); assert.equal(q.doors, 1);
  near(q.slabM2, 160, 0.005, "2 slabs × 80 m²");
  // concrete: slabs 2 × 10 × 8 × 0.2 = 32; strip (2(10+8) − 4·0.5) × 0.5 × 0.8 = 13.6 → 45.6 m³; rebar 100 kg/m³ → 4.56 t
  near(q.concreteM3, 45.6, 0.005); near(q.rebarT, 4.56, 0.005);
  near(q.roofM2, 11 * 9 * RULES.roofPitchFactor, 0.005, "roof 113.85 m²");
  // gross floor area = 2 × 80 m² (outer shell footprint per floor)
  near(siteStats(referenceHouse().parts, defaultSite()).floorArea, 160, 1e-9, "GFA");
});

test("G01 house: making floor 1 taller lifts everything above by the same amount; openings follow", () => {
  const before = referenceHouse();
  const { scene } = applyOps(before, [{ op: "set", id: "r-walls1", h: 3.0 }], () => "x");
  const dy = 0.2;
  for (const id of ["r-slab2", "r-walls2", "r-roof", "r-win2", "r-win3"]) near(get(scene.parts, id).y, get(before.parts, id).y + dy, 1e-9, id);
  for (const id of ["r-found", "r-slab1", "r-walls1", "r-door", "r-win1"]) near(get(scene.parts, id).y, get(before.parts, id).y, 1e-9, id);
});

test("G01 house: IFC export declares SI metres and puts storeys at 0.0 and 3.0 m", () => {
  const ifc = toIfc(referenceHouse());
  assert.match(ifc, /IFCSIUNIT\(\*,\.LENGTHUNIT\.,\$,\.METRE\.\)/); // no prefix: metres, not millimetres
  assert.match(ifc, /IFCSIUNIT\(\*,\.AREAUNIT\.,\$,\.SQUARE_METRE\.\)/);
  const elevs = [...ifc.matchAll(/IFCBUILDINGSTOREY\([^;]*,(-?[\d.]+)\);/g)].map((m) => Number(m[1]));
  assert.deepEqual(elevs, [0, 3]);
  assert.match(ifc, /IFCWINDOW\([^;]*,1\.2,2\.4,/); // height, width in metres
  assert.match(ifc, /IFCDOOR\([^;]*,2\.1,1\.,/);
  assert.equal(referenceHouse().parts.filter((p) => isOpening(p.kind)).length, 4);
});

/* ---------------- G05: daylight reference matrix ---------------- */

// Independent NOAA spreadsheet implementation (https://gml.noaa.gov/grad/solcalc/calcdetails.html, "NOAA_Solar_Calculations_day.xls"):
// Julian century, geometric mean longitude/anomaly, equation of centre, apparent longitude, corrected obliquity, declination,
// equation of time, true solar time, hour angle, zenith; azimuth by the sheet's acos form (sun-pure uses atan2). No refraction.
const D = Math.PI / 180, sd = (x: number) => Math.sin(x * D), cd = (x: number) => Math.cos(x * D), mod = (a: number, n: number) => ((a % n) + n) % n;
function noaa(lat: number, lon: number, t: Date) {
  const jd = t.getTime() / 86_400_000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360), M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = sd(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sd(2 * M) * (0.019993 - 0.000101 * T) + sd(3 * M) * 0.000289;
  const app = L0 + C - 0.00569 - 0.00478 * sd(125.04 - 1934.136 * T);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * cd(125.04 - 1934.136 * T);
  const dec = Math.asin(sd(eps) * sd(app)) / D, y = Math.tan((eps / 2) * D) ** 2;
  const eot = 4 / D * (y * sd(2 * L0) - 2 * e * sd(M) + 4 * e * y * sd(M) * cd(2 * L0) - 0.5 * y * y * sd(4 * L0) - 1.25 * e * e * sd(2 * M));
  const utcMin = (t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60);
  const tst = mod(utcMin + eot + 4 * lon, 1440), ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const zen = Math.acos(sd(lat) * sd(dec) + cd(lat) * cd(dec) * cd(ha)) / D;
  const a = Math.acos(Math.max(-1, Math.min(1, (sd(lat) * cd(zen) - sd(dec)) / (cd(lat) * sd(zen))))) / D;
  return { az: ha > 0 ? mod(a + 180, 360) : mod(540 - a, 360), alt: 90 - zen };
}

const PLACES = [
  { name: "Tallinn", lat: 59.437, lon: 24.745, tz: "Europe/Tallinn" },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, tz: "Australia/Sydney" },
  { name: "Quito", lat: -0.1807, lon: -78.4678, tz: "America/Guayaquil" },
];
const DATES = ["2026-03-20", "2026-06-21", "2026-12-21"];
const HOURS = [9, 12, 15];
const TOL = 0.5; // degrees, stated tolerance for the matrix

test("G05 matrix: ORBIT sun azimuth/altitude vs independent NOAA within 0.5° (site local wall-clock time)", () => {
  const rows: string[] = [];
  for (const p of PLACES) for (const date of DATES) for (const h of HOURS) {
    const t = siteInstant(date, h, p.tz), ref = noaa(p.lat, p.lon, t), got = sunPosition(p.lat, p.lon, t);
    const dAz = Math.abs(mod(got.azimuthDeg - ref.az + 180, 360) - 180), dAlt = Math.abs(got.elevationDeg - ref.alt);
    rows.push(`|${p.name}|${date} ${String(h).padStart(2, "0")}:00 (${t.toISOString().slice(11, 16)}Z)|${ref.az.toFixed(2)} / ${ref.alt.toFixed(2)}|${got.azimuthDeg.toFixed(2)} / ${got.elevationDeg.toFixed(2)}|${Math.max(dAz, dAlt).toFixed(4)}|`);
    // near the zenith azimuth is ill-conditioned; only Quito at equinox noon gets there (alt > 89.5°)
    if (ref.alt < 89.5) assert.ok(dAz <= TOL, `${p.name} ${date} ${h}h az ${got.azimuthDeg} vs ${ref.az}`);
    assert.ok(dAlt <= TOL, `${p.name} ${date} ${h}h alt ${got.elevationDeg} vs ${ref.alt}`);
  }
  if (process.env.ARCH_MATRIX) console.log(rows.join("\n"));
});

test("G05 closed-form anchors: noon altitude = 90 − |lat − declination| at solstice/equinox", () => {
  // solar noon: 12:00 local mean time minus the equation of time; ε = 23.44°. ±0.3° covers EoT/declination drift through the day.
  const noonAlt = (lat: number, lon: number, date: string) => {
    let best = -90; for (let m = 0; m < 1440; m += 1) best = Math.max(best, sunPosition(lat, lon, new Date(Date.parse(`${date}T00:00Z`) - lon * 240_000 + m * 60_000)).elevationDeg); return best;
  };
  near(noonAlt(59.437, 24.745, "2026-06-21"), 90 - 59.437 + 23.44, 0.3, "Tallinn summer");
  near(noonAlt(59.437, 24.745, "2026-12-21"), 90 - 59.437 - 23.44, 0.3, "Tallinn winter (7.1°)");
  near(noonAlt(-33.8688, 151.2093, "2026-12-21"), 90 - 33.8688 + 23.44, 0.3, "Sydney summer");
  near(noonAlt(-0.1807, -78.4678, "2026-03-20"), 89.8, 0.3, "Quito equinox ~overhead");
});

test("G05 time zones: Tallinn noon is 09:00Z in summer (UTC+3) and 10:00Z in winter (UTC+2), on any host zone", () => {
  const old = process.env.TZ;
  try {
    for (const host of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = host;
      assert.equal(siteInstant("2026-06-21", 12, "Europe/Tallinn").toISOString(), "2026-06-21T09:00:00.000Z");
      assert.equal(siteInstant("2026-12-21", 12, "Europe/Tallinn").toISOString(), "2026-12-21T10:00:00.000Z");
      assert.equal(siteInstant("2026-06-21", 12.25, "Australia/Sydney").toISOString(), "2026-06-21T02:15:00.000Z"); // AEST +10 (winter)
      assert.equal(siteInstant("2026-12-21", 12, "Australia/Sydney").toISOString(), "2026-12-21T01:00:00.000Z"); // AEDT +11
    }
    // DST switch days in Tallinn (2026-03-29 03:00→04:00, 2026-10-25 04:00→03:00)
    assert.equal(siteInstant("2026-03-29", 2, "Europe/Tallinn").toISOString(), "2026-03-29T00:00:00.000Z");
    assert.equal(siteInstant("2026-03-29", 5, "Europe/Tallinn").toISOString(), "2026-03-29T02:00:00.000Z");
    assert.equal(siteInstant("2026-10-25", 12, "Europe/Tallinn").toISOString(), "2026-10-25T10:00:00.000Z");
    // the ARCH sun panel's current construction reads the hour in the HOST zone: on a UTC host Tallinn "12:00" is 3 h late,
    // which moves the summer sun ~45° west. This is the bug siteInstant fixes (ArchWorld wiring pending, see PR).
    process.env.TZ = "UTC";
    const hostRead = new Date("2026-06-21T00:00"); hostRead.setMinutes(12 * 60);
    assert.equal(hostRead.toISOString(), "2026-06-21T12:00:00.000Z");
    const dAz = sunPosition(59.437, 24.745, hostRead).azimuthDeg - sunPosition(59.437, 24.745, siteInstant("2026-06-21", 12, "Europe/Tallinn")).azimuthDeg;
    assert.ok(dAz > 40, `host-zone reading shifts azimuth by ${dAz}°`);
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test("G05 true north: rotating the site by θ rotates the sun bearing and the shadow by exactly θ", () => {
  const t = siteInstant("2026-06-21", 15, "Europe/Tallinn"), s = sunPosition(59.437, 24.745, t), dir = sunDirection(59.437, 24.745, t);
  const bearing = (v: { x?: number; z?: number; dx?: number; dz?: number }) => mod(Math.atan2(v.x ?? v.dx!, -(v.z ?? v.dz!)) / D, 360);
  const base = shadowOf(s, 6)!;
  for (const north of [0, 15, 90, -30, 180]) {
    near(mod(bearing(toModel(dir, north)) - s.azimuthDeg - north + 180, 360) - 180, 0, 1e-9, `sun bearing @${north}`);
    // ArchWorld feeds the shadow azimuth + site.north (model bearing): same length, direction turned by north
    const sh = shadowOf({ ...s, azimuthDeg: s.azimuthDeg + north }, 6)!;
    near(sh.length, base.length, 1e-9);
    near(mod(bearing(sh) - bearing(base) - north + 180, 360) - 180, 0, 1e-9, `shadow @${north}`);
    // and it agrees with the model-axes sun vector: shadow points exactly opposite the sun's horizontal direction
    const m = toModel(dir, north);
    near(mod(bearing(sh) - bearing(m) + 360, 360), 180, 1e-9, `shadow opposite sun @${north}`);
  }
});

test("G05 units: positions in degrees, shadowOf takes degrees (45° → length = height, 30° → h·√3)", () => {
  const s = sunPosition(59.437, 24.745, siteInstant("2026-06-21", 12, "Europe/Tallinn"));
  assert.ok(s.azimuthDeg >= 0 && s.azimuthDeg < 360 && s.elevationDeg > 50 && s.elevationDeg < 55, "degrees, not radians");
  near(shadowOf({ azimuthDeg: 180, elevationDeg: 45 }, 3)!.length, 3, 1e-9);
  near(shadowOf({ azimuthDeg: 180, elevationDeg: 30 }, 3)!.length, 3 * Math.sqrt(3), 1e-9);
  const south = shadowOf({ azimuthDeg: 180, elevationDeg: 45 }, 3)!; // sun in the south: shadow points north (−z)
  near(south.dx, 0, 1e-9); near(south.dz, -3, 1e-9);
  const east = shadowOf({ azimuthDeg: 90, elevationDeg: 45 }, 3)!; // sun in the east: shadow points west (−x)
  near(east.dx, -3, 1e-9); near(east.dz, 0, 1e-9);
});
