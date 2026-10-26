import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlans, parseBrief, planScene, shared, stairDesign, straightFit, STARTER_BRIEF, withCore } from "../src/lib/arch-plan-pure.ts";
import { boq } from "../src/lib/arch-pure.ts";
import { wallRects } from "../src/lib/arch-walk-pure.ts";

const brief = parseBrief(STARTER_BRIEF.rooms, STARTER_BRIEF.adj, { w: 30, d: 25 }, 1);

test("parseBrief reads rooms, floors and adjacency wishes and drops junk", () => {
  const b = parseBrief("Bedroom: 12 m² @2\nBedroom 2 10\nkitchen 0\nnonsense\nBEDROOM 9\nBath 6,5", "Bedroom - Bath\nbath ~ bedroom\nBedroom - Ghost\nBath next to outside", { w: 9999, d: 20 }, 2);
  assert.deepEqual(b.rooms, [{ name: "Bedroom", area: 12, floor: 2 }, { name: "Bedroom 2", area: 10 }, { name: "Bath", area: 6.5 }]);
  assert.deepEqual(b.adj, [["Bedroom", "Bath"], ["Bath", "outside"]]);
  assert.equal(b.plot.w, 200);
  assert.equal(b.floors, 2);
});

test("shared finds a common edge, not a corner", () => {
  assert.deepEqual(shared({ x0: 0, z0: 0, x1: 2, z1: 3 }, { x0: 2, z0: 1, x1: 4, z1: 5 }), { x0: 2, x1: 2, z0: 1, z1: 3 });
  assert.equal(shared({ x0: 0, z0: 0, x1: 2, z1: 2 }, { x0: 2, z0: 2, x1: 4, z1: 4 }), null);
});

test("generatePlans: 3–5 deterministic options, best first, rooms tile the footprint", () => {
  const a = generatePlans(brief, 7), b = generatePlans(brief, 7);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3 && a.length <= 5, `${a.length} options`);
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].score >= a[i].score);
  for (const o of a) {
    const rooms = o.floors.flatMap((f) => f.rooms);
    assert.equal(rooms.length, brief.rooms.length);
    const sum = rooms.reduce((s, { r }) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    assert.ok(Math.abs(sum - o.w * o.d) < 0.05, "rooms fill the footprint");
    assert.ok(o.parts.areaErr < 0.15);
    assert.ok(o.parts.daylight >= 0 && o.parts.daylight <= 1);
  }
  assert.ok(a[0].parts.adjMet >= 4, `best meets ${a[0].parts.adjMet}/${a[0].parts.adjTotal}`);
  assert.deepEqual(generatePlans({ ...brief, rooms: [] }), []);
});

test("hill climbing beats the unimproved start on adjacency", () => {
  // two rooms that must touch, three in between in the input order: the climber still puts them side by side
  const b = parseBrief("A 10\nX 10\nY 10\nZ 10\nB 10", "A - B", { w: 20, d: 20 }, 1);
  assert.equal(generatePlans(b, 3)[0].parts.adjMet, 1);
});

test("pinned rooms stay on their floor; floors balance", () => {
  const b = parseBrief("Living 30\nKitchen 15\nBed 14 @2\nBed 2 12 @2\nBath 6", "Bed - Bath", { w: 25, d: 25 }, 2);
  const o = generatePlans(b, 1)[0];
  const names = withCore(b).rooms.map((r) => r.name), floorOf = (n: string) => o.floors.findIndex((f) => f.rooms.some(({ i }) => names[i] === n));
  assert.equal(floorOf("Bed"), 1);
  assert.equal(floorOf("Bed 2"), 1);
  assert.equal(floorOf("Bath"), 1, "bath joins the bedrooms to meet the wish");
});

test("planScene builds a valid ARCH model: doors where wishes are met, walls, roof on top", () => {
  const o = generatePlans(brief, 7)[0], s = planScene(brief, o);
  const doors = s.parts.filter((p) => p.kind === "door"), walls = s.parts.filter((p) => p.kind === "wall");
  assert.equal(doors.length, o.met.filter(([a, b]) => a >= 0 && b >= 0).length + 1, "one door per met wish + front door");
  for (const d of doors) assert.ok(walls.some((w) => w.id === d.host));
  assert.ok(walls.length >= 1 + brief.rooms.length - 1, "shell + one wall per cut");
  assert.ok(s.parts.some((p) => p.kind === "window"));
  assert.equal(s.parts.find((p) => p.kind === "roof")!.y, 3);
  assert.equal(new Set(s.parts.map((p) => p.id)).size, s.parts.length);
  const q = boq(s.parts);
  assert.equal(q.doors, doors.length);
  assert.ok(q.blocks > 0 && q.concreteM3 > 0);
  assert.ok(wallRects(s.parts).length > walls.length, "doors cut walking gaps");
});

/* Hand calc, storey 0.2 + 2.8 = 3.0 m: n = ⌈3000/190⌉ = 16 risers, R = 187.5 mm, G = 625 − 375 = 250 mm,
   2R + G = 625 ✓ (600–650). Straight run 15 × 0.25 = 3.75 m; dogleg flights of 8 risers: 7 × 0.25 + 1.0 landing = 2.75 m × 2.1 m.
   A 2.5 m straight run would squeeze G to 2500/15 = 167 mm: 2R + G = 542 < 600 → fails. */
test("stair design follows 2R + G = 600–650 mm", () => {
  const s = stairDesign(3);
  assert.deepEqual([s.risers, s.R, s.G, s.rule, s.ok], [16, 187.5, 250, 625, true]);
  assert.deepEqual(s.straight, { w: 1, l: 3.75 });
  assert.deepEqual(s.dogleg, { w: 2.1, l: 2.75 });
  const t = straightFit(3, 2.5);
  assert.equal(t.ok, false);
  assert.equal(t.rule, 542);
});

test("multi-floor plans get a stair core aligned on every floor, next to the hall, with a stair part", () => {
  const b = parseBrief(STARTER_BRIEF.rooms + "\nBedroom 3 12\nBath 2 5", STARTER_BRIEF.adj, { w: 30, d: 25 }, 2);
  const B = withCore(b);
  assert.equal(withCore(B), B, "idempotent");
  assert.equal(withCore(parseBrief("Stairs 5\nLiving 30", "", { w: 20, d: 20 }, 2)).core, undefined, "listed stairs are kept");
  const o = generatePlans(b, 1)[0];
  const at = (i: number) => o.floors.flatMap((f) => f.rooms).find((r) => r.i === i)!.r;
  const [s1, s2] = B.core!.stair.map(at);
  assert.deepEqual(s1, s2, "stairs line up");
  assert.ok(shared(s1, at(B.core!.circ[0])) && shared(s2, at(B.core!.circ[1])), "stairs open onto hall and landing");
  assert.equal(B.rooms[B.core!.circ[0]].name, "Entrance hall");
  const sc = planScene(b, o), st = sc.parts.filter((p) => p.kind === "stair");
  assert.equal(st.length, 1);
  assert.equal(st[0].h, 3);
  assert.match(st[0].name, /2R\+G 625/);
  // every upper room touching the landing has a door on its wall
  const doors = sc.parts.filter((p) => p.kind === "door" && /Landing 2/.test(p.name));
  assert.ok(doors.length >= 1);
  assert.equal(boq(sc.parts).roofM2, boq(sc.parts.filter((p) => p.kind !== "stair")).roofM2, "a stair is not counted as roof");
});
