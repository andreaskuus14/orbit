import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCRIPTS, attachErrors, districtOf, heightFor, layoutGrid, parseScriptList } from "../src/lib/grid-pure.ts";

test("parseScriptList reads Studio Output lines, drops junk and duplicates", () => {
  const out = parseScriptList([
    "14:02:11.123  ServerScriptService.Pets.PetHandler 120  -  Edit",
    "game.Workspace.Door.Script\t8",
    "ServerScriptService.Pets.PetHandler 999",
    "hello world",
    "",
    "42",
    "ReplicatedStorage.Modules.Util, 300",
  ].join("\n"));
  assert.deepEqual(out, [
    { path: "ServerScriptService.Pets.PetHandler", lines: 120 },
    { path: "Workspace.Door.Script", lines: 8 },
    { path: "ReplicatedStorage.Modules.Util", lines: 300 },
  ]);
  assert.equal(parseScriptList(Array.from({ length: MAX_SCRIPTS + 50 }, (_, i) => `Workspace.S${i} 1`).join("\n")).length, MAX_SCRIPTS);
});

test("districtOf groups by service, or service.folder when deeper", () => {
  assert.equal(districtOf("ServerScriptService.Main"), "ServerScriptService");
  assert.equal(districtOf("ServerScriptService.Pets.PetHandler"), "ServerScriptService.Pets");
});

test("attachErrors maps console lines to the longest matching script path", () => {
  const s = attachErrors([
    { path: "ServerScriptService.Pets", lines: 10 },
    { path: "ServerScriptService.Pets.PetHandler", lines: 50 },
    { path: "ServerScriptService.PetsShop", lines: 5 },
  ], [
    "ServerScriptService.Pets.PetHandler:42: attempt to index nil with 'Parent'",
    "Script 'ServerScriptService.Pets', Line 3",
    "Infinite yield possible on 'Workspace.Nope'",
    "ServerScriptService.Pets.PetHandler:42: attempt to index nil with 'Parent'",
  ].join("\n"));
  assert.deepEqual(s.map((x) => x.errors.length), [1, 1, 0]);
  assert.equal(s[1].name, "PetHandler");
  assert.equal(s[1].district, "ServerScriptService.Pets");
});

test("layoutGrid: one building per script, taller for more lines, districts don't overlap", () => {
  const list = attachErrors([
    { path: "ServerScriptService.A", lines: 400 }, { path: "ServerScriptService.B", lines: 100 },
    { path: "ReplicatedStorage.M.X", lines: 50 }, { path: "ReplicatedStorage.M.Y", lines: 10 }, { path: "Workspace.Door.Script", lines: 1 },
  ], "");
  const g = layoutGrid(list);
  assert.equal(g.buildings.length, 5);
  assert.equal(g.maxLines, 400);
  const h = (p: string) => g.buildings.find((b) => b.script.path === p)!.h;
  assert.ok(h("ServerScriptService.A") > h("ServerScriptService.B") && h("ServerScriptService.B") > h("Workspace.Door.Script"));
  assert.deepEqual(g.districts.map((d) => d.name), ["ReplicatedStorage.M", "ServerScriptService", "Workspace.Door"]);
  for (const a of g.districts) for (const b of g.districts) if (a !== b)
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.z + a.d <= b.z || b.z + b.d <= a.z, `${a.name} overlaps ${b.name}`);
  for (const b of g.buildings) {
    const d = g.districts.find((q) => q.name === b.script.district)!;
    assert.ok(b.x > d.x && b.x < d.x + d.w && b.z > d.z && b.z < d.z + d.d);
  }
  assert.ok(heightFor(0, 0) > 0);
  assert.deepEqual(layoutGrid([]), { buildings: [], districts: [], size: 0, maxLines: 0 });
});
