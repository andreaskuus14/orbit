import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConnectivity, classifySpace, ensureConnectedDoors, generatePlans, parseBrief, planScene, shared, slabAround, stairDesign, straightFit, STARTER_BRIEF, windowSizeForRoom, withCore } from "../src/lib/arch-plan-pure.ts";
import { boq, costLines, isStraightWall, STARTER_PRICES } from "../src/lib/arch-pure.ts";
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
  assert.ok(doors.length >= o.met.filter(([a, b]) => a >= 0 && b >= 0).length + 1, "at least one door per met wish + front door (plus connectivity doors)");
  assert.deepEqual(o.unreachableRooms, []);
  assert.equal(o.connectivityScore, 1);
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
test("slabAround: four pieces round an inner hole, fewer at an edge", () => {
  assert.equal(slabAround(10, 8, { x0: -1, x1: 1, z0: -1, z1: 1 }).length, 4);
  const edge = slabAround(10, 8, { x0: -5, x1: -3, z0: -4, z1: -1 });
  assert.deepEqual(edge.map((p) => p.side), ["east", "south"]);
  assert.equal(edge.reduce((a, p) => a + p.w * p.d, 0), 80 - 6);
});

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
  assert.equal(boq(sc.parts).risers, stairDesign(3).risers, "the stair is priced per riser");
  // the upper slab has a stairwell over the stair: no floor-2 slab piece covers the stair's centre, and the pieces add up
  const up = sc.parts.filter((p) => p.kind === "slab" && /^Floor 2/.test(p.name)), S = at(B.core!.stair[0]);
  assert.ok(up.length >= 2);
  assert.ok(!up.some((p) => Math.abs(st[0].x - p.x) < p.w / 2 && Math.abs(st[0].z - p.z) < p.d / 2), "stairwell is open");
  const area = up.reduce((a, p) => a + p.w * p.d, 0);
  assert.ok(Math.abs(area - (o.w * o.d - (S.x1 - S.x0) * (S.z1 - S.z0))) < 0.05);
  assert.equal(sc.parts.filter((p) => p.kind === "slab" && /^Floor 1/.test(p.name)).length, 1, "ground slab stays whole");
});

test("outdoor / unheated space classification and terrace deck representation", () => {
  for (const n of ["Terrace", "South terrace", "Balcony", "Porch", "Patio", "Deck", "Veranda", "Carport", "Terrass", "Rõdu", "Varjualune"]) {
    assert.equal(classifySpace(n), "outdoor", `${n} should be outdoor`);
  }
  for (const n of ["Garage", "Garaaž", "Storage", "Panipaik"]) {
    assert.equal(classifySpace(n), "unheated", `${n} should be unheated`);
  }
  for (const n of ["Living", "Kitchen", "Bedroom", "Bath", "Entrance hall"]) {
    assert.equal(classifySpace(n), "heated", `${n} should be heated`);
  }

  const baseRooms = "Entrance hall 8\nLiving 28\nKitchen 12\nBedroom 14\nBath 6\nStorage 4";
  const baseAdj = "Living - Entrance hall\nLiving - Kitchen\nBedroom - Entrance hall\nBath - Entrance hall\nEntrance hall - outside";
  const withTerrace = parseBrief(`${baseRooms}\nTerrace 20`, `${baseAdj}\nLiving - Terrace`, { w: 30, d: 25 }, 1);
  const withoutTerrace = parseBrief(baseRooms, baseAdj, { w: 30, d: 25 }, 1);
  const oT = generatePlans(withTerrace, 2)[0];
  const oNo = generatePlans(withoutTerrace, 2)[0];
  const sT = planScene(withTerrace, oT);
  const sNo = planScene(withoutTerrace, oNo);

  // Heated area excludes terrace (and unheated storage), outdoorAreaM2 tracks terrace
  assert.ok(oT.outdoorAreaM2 >= 18 && oT.outdoorAreaM2 <= 22, `outdoorAreaM2=${oT.outdoorAreaM2}`);
  assert.ok(oT.heatedAreaM2 < oT.w * oT.d + oT.outdoorAreaM2, "terrace excluded from heatedAreaM2");
  assert.equal(oT.w, oNo.w, "indoor footprint width unchanged by outdoor terrace");
  assert.equal(oT.d, oNo.d, "indoor footprint depth unchanged by outdoor terrace");

  // Terrace is a low exterior deck slab, NOT enclosed in exterior walls/roof/windows
  const deck = sT.parts.find((p) => p.kind === "slab" && p.group === "exterior" && /terrace/i.test(p.name));
  assert.ok(deck, "terrace gets an exterior deck slab");
  assert.ok(deck.h <= 0.2, `deck height ${deck.h} should be low`);
  const shell = sT.parts.find((p) => p.kind === "wall" && !isStraightWall(p))!;
  assert.equal(shell.w, oT.w);
  assert.equal(shell.d, oT.d);
  assert.ok(Math.abs(deck.x) >= shell.w / 2 || Math.abs(deck.z) >= shell.d / 2, "deck sits outside the heated shell");
  assert.ok(!sT.parts.some((p) => p.kind === "window" && /terrace/i.test(p.name)), "terrace has no exterior window");

  // BOQ roof area is identical with or without outdoor terrace (terrace is not roofed)
  assert.equal(boq(sT.parts).roofM2, boq(sNo.parts).roofM2, "terrace does not inflate roof BOQ");
});

test("multi-storey 12+ room house has 0 unreachable rooms on F1 and F2 via BFS connectivity", () => {
  const rooms = [
    "Entrance hall 8 @1", "Living 28 @1", "Kitchen 14 @1", "Dining 12 @1", "Study 10 @1", "Utility 6 @1", "WC 3 @1",
    "Master bedroom 16 @2", "Bedroom 2 12 @2", "Bedroom 3 12 @2", "Bath 8 @2", "Wardrobe 5 @2", "Office 10 @2",
  ].join("\n");
  const adj = "Living - Kitchen\nLiving - Entrance hall\nEntrance hall - outside\nMaster bedroom - Bath";
  const b = parseBrief(rooms, adj, { w: 30, d: 25 }, 2);
  const B = withCore(b);
  const o = generatePlans(b, 3)[0];
  assert.deepEqual(o.unreachableRooms, [], "0 unreachable rooms across all floors");
  assert.equal(o.connectivityScore, 1);

  // Independently verify BFS on both F1 and F2 using the doors from the plan
  o.floors.forEach((fl, f) => {
    const res = checkConnectivity(B, fl, f, fl.doors ?? [], { w: o.w, d: o.d });
    assert.deepEqual(res.unreachable, [], `floor ${f + 1} has 0 unreachable rooms`);
    assert.equal(res.score, 1, `floor ${f + 1} connectivity score = 1`);
  });

  // Verify checkConnectivity detects disconnected rooms and ensureConnectedDoors repairs them
  const fl0 = o.floors[0];
  const broken = checkConnectivity(B, fl0, 0, [], { w: o.w, d: o.d });
  assert.ok(broken.unreachable.length > 0, "empty door set leaves rooms unreachable");
  assert.ok(broken.score < 1);
  const repaired = ensureConnectedDoors(B, fl0, 0, [], { w: o.w, d: o.d });
  assert.deepEqual(repaired.connectivity.unreachable, []);
  assert.equal(repaired.connectivity.score, 1);
  assert.ok(repaired.added.length >= broken.unreachable.length);

  // Scene BOQ prices interior doors separately from exterior doors
  const sc = planScene(b, o), q = boq(sc.parts), c = costLines(q, STARTER_PRICES, sc.parts);
  assert.ok((q.interiorDoors ?? 0) >= 8, `expected many interior doors, got ${q.interiorDoors}`);
  assert.equal(q.exteriorDoors, 1, "only front door is exterior");
  const extLine = c.lines.find((l) => l.key === "doors")!;
  const intLine = c.lines.find((l) => l.key === "interiorDoors")!;
  assert.ok(intLine.eur! < extLine.eur!, "interior door costs less than exterior insulated door");
});

test("proportional habitable window sizing achieves >= 12% WFR for large living room", () => {
  // Direct unit check on windowSizeForRoom
  const livingWin = windowSizeForRoom("Living", 28, 6);
  assert.ok(livingWin && livingWin.w >= 1.2 && livingWin.w <= 3.6 && livingWin.h >= 1.4 && livingWin.h <= 2.1);
  assert.ok((livingWin.w * livingWin.h) / 28 >= 0.12, `28 m² living WFR = ${((livingWin.w * livingWin.h) / 28).toFixed(3)}`);
  const bathWin = windowSizeForRoom("Bath", 6, 3);
  assert.ok(bathWin && bathWin.w >= 0.8 && bathWin.w <= 1.0, "bath gets compact window");
  assert.equal(windowSizeForRoom("Terrace", 20, 5), null, "outdoor terrace gets no window");

  // Full plan + scene check: ~28 m² Living room gets >= 12% WFR (much more than hardcoded 1.44 m²)
  const b = parseBrief("Entrance hall 8\nLiving 28\nKitchen 12\nBedroom 14\nBath 6", "Living - Entrance hall\nLiving - Kitchen\nBedroom - Entrance hall\nEntrance hall - outside", { w: 30, d: 25 }, 1);
  const o = generatePlans(b, 1)[0];
  const s = planScene(b, o);
  const livingIdx = b.rooms.findIndex((r) => r.name === "Living");
  const livingRect = o.floors[0].rooms.find((r) => r.i === livingIdx)!.r;
  const livingArea = (livingRect.x1 - livingRect.x0) * (livingRect.z1 - livingRect.z0);
  const livingWindows = s.parts.filter((p) => p.kind === "window" && /Window Living/.test(p.name));
  assert.ok(livingWindows.length >= 1, "living room has at least one window");
  const glazedM2 = livingWindows.reduce((sum, w) => sum + w.w * w.h, 0);
  assert.ok(glazedM2 > 1.44, `living glazing ${glazedM2} m² exceeds old hardcoded 1.44 m²`);
  assert.ok(glazedM2 / livingArea >= 0.12, `living WFR ${(glazedM2 / livingArea * 100).toFixed(1)}% >= 12%`);
});
