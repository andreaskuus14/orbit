import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkPlan, cleanPlan, danglingWalls, findRooms, footprints, offsetPoly, planFromBrief, planFromRaw, planStats, planToScene, polyArea, rectangles,
  roomKind, samplePlan, signedArea, wallChains, FP, RULE, type FloorPlan,
} from "../src/lib/arch-floorplan-pure.ts";
import { jsonIn, planFromReply, studioProgress, studioSteps } from "../src/lib/arch-sketch-pure.ts";
import { boq, isOpening } from "../src/lib/arch-pure.ts";
import { toIfc } from "../src/lib/arch-ifc-pure.ts";
import { checkIfc } from "../src/lib/arch-export-pure.ts";
import { wallRects, collides } from "../src/lib/arch-walk-pure.ts";
import { daylightPlan } from "../src/lib/arch-daylight-pure.ts";
import { sunPosition } from "../src/lib/sun-pure.ts";
import { shadowOf } from "../src/lib/arch-time-pure.ts";

const rect = (x0: number, z0: number, x1: number, z1: number) => [{ a: [x0, z0], b: [x1, z0] }, { a: [x1, z0], b: [x1, z1] }, { a: [x1, z1], b: [x0, z1] }, { a: [x0, z1], b: [x0, z0] }];
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test("shoelace, offset and rectangle maths on hand-checkable shapes", () => {
  const sq: [number, number][] = [[0, 0], [4, 0], [4, 5], [0, 5]];
  near(signedArea(sq), 20); near(polyArea([...sq].reverse()), 20);
  // a 4 × 5 m room with 0.2 m walls all round: net = 3.8 × 4.8
  near(polyArea(offsetPoly(sq, [0.1, 0.1, 0.1, 0.1])), 3.8 * 4.8);
  // walls of different thickness: outer 0.3 on two sides, inner 0.12 on the others
  near(polyArea(offsetPoly(sq, [0.15, 0.06, 0.06, 0.15])), (4 - 0.21) * (5 - 0.21));
  // L shape (12×9 minus a 4×3 notch... as an L of 8×9 + 4×6) → 2 rectangles, same area
  const L: [number, number][] = [[0, 0], [12, 0], [12, 6], [8, 6], [8, 9], [0, 9]];
  const rs = rectangles(L);
  near(rs.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0), polyArea(L));
  assert.equal(rs.length, 2);
});

test("clean-up: weld, square up, grid, split at T junctions and crossings", () => {
  // a wobbly hand-drawn 6 × 4 box with a partition that stops at the walls and corners that miss by a few cm
  const raw = { walls: [{ a: [0.04, -0.03], b: [6.02, 0.1] }, { a: [6.08, 0.02], b: [5.97, 4.01] }, { a: [6, 4], b: [0, 3.92] }, { a: [-0.05, 4.03], b: [0, 0.06] }, { a: [3.03, 0.05], b: [2.98, 3.97] }],
    rooms: [{ name: "Bedroom", x: 1.5, z: 2 }, { name: "Kitchen", x: 4.5, z: 2 }] };
  const p = planFromRaw(raw, "sketch");
  for (const n of p.nodes) { near(n.x / FP.grid, Math.round(n.x / FP.grid), 1e-9); near(n.z / FP.grid, Math.round(n.z / FP.grid), 1e-9); }
  const rooms = findRooms(p);
  assert.equal(rooms.length, 2, "the partition splits the box (T junctions were split)");
  assert.deepEqual(rooms.map((r) => r.name).sort(), ["Bedroom", "Kitchen"]);
  near(rooms.reduce((s, r) => s + r.gross, 0), 6 * 4, 0.6); // centre-line area, give or take the averaged hand wobble
  assert.equal(danglingWalls(p).length, 0);
  // idempotent
  assert.deepEqual(cleanPlan(p), p);
  // a crossing (+) in the middle makes four rooms
  const plus = planFromRaw({ walls: [...rect(0, 0, 6, 6), { a: [3, 0], b: [3, 6] }, { a: [0, 3], b: [6, 3] }] }, "sketch");
  assert.equal(findRooms(plus).length, 4);
  findRooms(plus).forEach((r) => near(r.gross, 9));
});

test("sample house: rooms, gross and net areas by hand", () => {
  const p = samplePlan(), rooms = findRooms(p), by = new Map(rooms.map((r) => [r.name, r]));
  assert.equal(rooms.length, 8);
  // gross = centre-line rectangles: 12 × 9 main + 4 × 3 garage
  near(planStats(p, rooms).gross, 12 * 9 + 4 * 3);
  // kitchen+living 8 × 4.5 to centre lines; outer walls 0.3 (north, west), inner 0.12 (east, south)
  const k = by.get("Kitchen + living")!;
  near(k.gross, 36); assert.deepEqual(k.rect, { w: 8 - 0.15 - 0.06, d: 4.5 - 0.15 - 0.06 }); near(k.net, (8 - 0.21) * (4.5 - 0.21), 1e-3);
  // footprint to the outer faces: (12.3 × 9.3) + garage (4.3 × 3.0, its top edge is under the main block's wall)
  near(planStats(p, rooms).footprint, 12.3 * 9.3 + 4.3 * 3.0, 1e-6);
  assert.equal(footprints(p).length, 1);
  assert.equal(roomKind("Kitchen + living"), "kitchen"); assert.equal(roomKind("Magamistuba"), "living"); assert.equal(roomKind("Saun"), "other"); assert.equal(roomKind("WC"), "wet");
  // wall thickness follows the rooms: walls between two rooms are inner
  const t = new Set(p.walls.map((w) => w.t)); assert.deepEqual([...t].sort(), [FP.innerT, FP.outerT]);
});

test("rule checks cite määrus nr 85 and catch each miss", () => {
  const p = samplePlan(), ok = checkPlan(p);
  assert.equal(ok.filter((c) => c.level === "fail" || c.level === "warn").length, 0, ok.filter((c) => c.level === "fail" || c.level === "warn").map((c) => c.text).join("; "));
  for (const c of ok.filter((x) => x.source)) assert.match(c.source!.url, /riigiteataja\.ee\/akt\/103072015034/);
  // small bedroom, narrow room, no window, narrow front door, low ceiling
  const bad = planFromRaw({ height: 2.2, walls: [...rect(0, 0, 2.2, 3), ...rect(2.2, 0, 6, 3)], openings: [{ kind: "door", x: 6, z: 1.5, w: 0.8 }, { kind: "door", x: 2.2, z: 1.5, w: 0.7 }, { kind: "window", x: 4, z: 0, w: 1.2 }],
    rooms: [{ name: "Bedroom", x: 1, z: 1.5 }, { name: "Living room", x: 4, z: 1.5 }] }, "sketch");
  const ids = checkPlan(bad).filter((c) => c.level === "fail" || c.level === "warn").map((c) => c.id.split(":")[0]);
  for (const id of ["area", "width", "window", "doorw", "height"]) assert.ok(ids.includes(id), `${id} missing in ${ids}`);
  assert.equal(RULE.doorOuter, 0.9); assert.equal(RULE.area, 8);
  // an open outline has no rooms and says so
  assert.equal(checkPlan(planFromRaw({ walls: [{ a: [0, 0], b: [5, 0] }, { a: [5, 0], b: [5, 4] }] }, "sketch"))[0].id, "closed");
});

test("wall runs fill every corner once (no double volume) and openings land in their walls", () => {
  const p = planFromRaw({ walls: [...rect(0, 0, 10, 8), { a: [5, 0], b: [5, 8] }], rooms: [] }, "sketch");
  const ch = wallChains(p);
  // 2 level runs (north, south, each one block through the T) + 3 plumb walls between them
  assert.equal(ch.filter((c) => c.o === "h").length, 2); assert.equal(ch.filter((c) => c.o === "v").length, 3);
  const vol = ch.reduce((s, c) => s + (c.hi - c.lo) * c.t, 0);
  // exact plan area of the walls: outer ring (10.3 × 8.3 − 9.7 × 7.7) + inner wall 0.12 × 7.7
  near(vol, 10.3 * 8.3 - 9.7 * 7.7 + 0.12 * 7.7, 1e-6);
  const s = planToScene(samplePlan()).scene;
  for (const o of s.parts.filter((x) => isOpening(x.kind))) assert.ok(s.parts.some((w) => w.id === o.host && w.kind === "wall"), o.name);
  assert.equal(s.parts.filter((x) => x.kind === "door").length, 9);
  assert.equal(s.parts.filter((x) => x.kind === "window").length, 8);
  assert.ok(boq(s.parts).wallM3 > 0);
});

test("plan → scene works with ARCH's IFC export, walk and daylight", () => {
  const s = planToScene(samplePlan()).scene;
  const failed = checkIfc(toIfc(s, { name: "Sample" }), s).filter((c) => !c.ok);
  assert.deepEqual(failed, []);
  const rects = wallRects(s.parts);
  // the hall's front door is a gap you can walk through, the wall beside it is not
  const front = s.parts.find((p) => p.name === "Front door")!;
  assert.equal(collides(front.x, front.z, rects, 0.2), false);
  assert.equal(collides(front.x, front.z - 1.2, rects, 0.05), true);
  const day = daylightPlan(s.parts);
  assert.equal(day.rooms.length, 8, "daylight study finds the same rooms");
});

test("brief path: the layout generator's option becomes a closed, checkable plan", () => {
  const p = planFromBrief({ rooms: [{ name: "Hall", area: 8 }, { name: "Kitchen + living", area: 30 }, { name: "Bedroom", area: 13 }, { name: "Bath", area: 6 }], adj: [["Hall", "outside"], ["Kitchen + living", "Hall"], ["Bedroom", "Hall"], ["Bath", "Hall"]] })!;
  const rooms = findRooms(p);
  assert.equal(rooms.length, 4);
  near(rooms.reduce((s, r) => s + r.gross, 0), 57, 57 * 0.25); // generator keeps areas within its error band
  assert.ok(p.openings.some((o) => o.kind === "door") && p.openings.some((o) => o.kind === "window"));
  assert.equal(planFromBrief({ rooms: [] }), null);
});

test("model replies: JSON in prose, junk refused, numbers clamped", () => {
  assert.deepEqual(jsonIn("Here: ```json\n{\"a\":1}\n```"), { a: 1 });
  assert.equal(planFromReply("sketch", "no plan here"), null);
  const p = planFromReply("sketch", JSON.stringify({ walls: [...rect(0, 0, 5, 4), { a: [0, 0], b: [1e9, 0] }], openings: [{ kind: "door", x: 2.5, z: 4, w: 99 }], rooms: [{ name: "x".repeat(200), x: 2, z: 2 }], unsure: ["scale from the door"] }))!;
  assert.equal(p.walls.length, 4, "the absurd wall is dropped");
  assert.ok(p.openings[0].w <= 6 && p.openings[0].w <= 5 - 2 * FP.end + 1e-9);
  assert.ok(findRooms(p)[0].name.length <= 40);
  assert.deepEqual(p.unsure, ["scale from the door"]);
});

test("progress card: steps, minutes only while the picture is read, result line", () => {
  const t0 = "2026-11-21T10:00:00.000Z", now = Date.parse(t0) + 20_000;
  const reading = studioProgress({ kind: "sketch", stage: 0, startedAt: t0 }, "en", now);
  assert.equal(reading.phase, "working"); assert.equal(reading.leftMin, 1); assert.equal(reading.steps[0].state, "now");
  assert.equal(studioSteps("sample", "en").length, 4); assert.equal(studioSteps("brief", "et")[0], "Paigutan ruumid");
  const plan: FloorPlan = samplePlan();
  const done = studioProgress({ kind: "sample", stage: 4, startedAt: t0, plan }, "en", now);
  assert.equal(done.phase, "done"); assert.match(done.result!.text, /^8 rooms · 108\.\d m² inside · rules OK$/); assert.equal(done.action?.kind, "open");
  const failed = studioProgress({ kind: "photo", stage: 0, startedAt: t0, failed: "Busy" }, "en", now);
  assert.equal(failed.phase, "failed"); assert.equal(failed.action?.kind, "retry"); assert.equal(failed.leftMin, null);
});

test("sun for the walk-through: noon shadow in Tallinn matches the hand formula", () => {
  // solar noon on the June solstice: elevation ≈ 90° − latitude + 23.44°; the 2.9 m eaves cast h / tan(el) to the north
  const lat = 59.437, lon = 24.754, noonUtc = new Date(Date.UTC(2026, 5, 21) + (12 - lon / 15) * 3_600_000 + 2 * 60_000); // ~10:23 UTC (+2 min equation of time)
  const sun = sunPosition(lat, lon, noonUtc);
  near(sun.elevationDeg, 90 - lat + 23.44, 0.3);
  near(sun.azimuthDeg, 180, 2);
  const h = FP.slab + 2.7, s = shadowOf(sun, h)!;
  near(s.length, h / Math.tan((sun.elevationDeg * Math.PI) / 180), 1e-6);
  near(s.towardDeg % 360, 0, 2); // the shadow points north
});
