import { test } from "node:test";
import assert from "node:assert/strict";
import { hoverParts, leadMoons, planetLife, toolPlanet } from "../src/lib/living-galaxy-pure.ts";

test("planetLife: no data is neutral; quiet is dim and cool, busy is warm, bright, bigger and faster", () => {
  assert.deepEqual(planetLife(undefined), { glow: 0, cool: 0, dim: 0, size: 1, spin: 1 });
  const q = planetLife(0), b = planetLife(1);
  assert.ok(q.dim > 0.3 && q.cool === 1 && q.glow === 0 && q.size < 1 && q.spin < 1);
  assert.ok(b.dim === 0 && b.cool === 0 && b.glow === 1 && b.size > 1 && b.spin > 1);
  for (const v of [NaN, -3, 7, Infinity]) for (const x of Object.values(planetLife(v))) assert.ok(Number.isFinite(x) && x >= 0);
});

test("leadMoons: one moon per open lead, new leads last, lost and junk skipped", () => {
  assert.deepEqual(leadMoons({ lead: 2, contacted: 1, paying: 1, lost: 5 }), ["paying", "contacted", "lead", "lead"]);
  assert.deepEqual(leadMoons(null), []);
  assert.deepEqual(leadMoons({ lead: -1, replied: NaN as number }), []);
});

test("leadMoons: capped, every stage keeps at least one moon, exact cap", () => {
  const m = leadMoons({ lead: 100, contacted: 40, pilot: 1, paying: 2 }, 24);
  assert.equal(m.length, 24);
  for (const s of ["lead", "contacted", "pilot", "paying"]) assert.ok(m.includes(s as never), s);
  assert.ok(m.filter((s) => s === "lead").length > m.filter((s) => s === "contacted").length);
  const tiny = leadMoons({ lead: 1, contacted: 1, replied: 1, pilot: 1, paying: 30 }, 4);
  assert.equal(tiny.length, 4);
});

test("toolPlanet: CORE steps land on the world they touch", () => {
  assert.equal(toolPlanet("lead_create"), "business");
  assert.equal(toolPlanet("lead_update"), "business");
  assert.equal(toolPlanet("vault_search"), "vault");
  assert.equal(toolPlanet("life_plan"), "life");
  assert.equal(toolPlanet("automation_create"), "operations");
  assert.equal(toolPlanet("web_search"), "edge");
  assert.equal(toolPlanet("fetch_url"), "edge");
  assert.equal(toolPlanet("search_memory"), "memory");
  assert.equal(toolPlanet("think"), null);
  assert.equal(toolPlanet("navigate"), null);
});

test("hoverParts: counts only, quiet worlds say so, nothing known → empty", () => {
  assert.deepEqual(hoverParts("vault", {}), []);
  assert.deepEqual(hoverParts("vault", { recent: { vault: 0 } }), [{ key: "galaxy.quiet" }]);
  assert.deepEqual(hoverParts("business", { stages: { lead: 3, paying: 1, lost: 9 }, recent: { business: 5 } }), [
    { key: "galaxy.leads", n: 4 }, { key: "galaxy.toContact", vars: { n: "3" } }, { key: "galaxy.won", vars: { n: "1" } }, { key: "galaxy.week", n: 5 }]);
  assert.deepEqual(hoverParts("life", { life: { done: 9, total: 4 } }), [{ key: "galaxy.habits", vars: { done: "4", total: "4" } }]);
  assert.deepEqual(hoverParts("memory", { memories: 12 }), [{ key: "overview.memories", n: 12 }]);
});

test("hoverParts: a world with events in the last 24 h says how many are new today, first", () => {
  assert.deepEqual(hoverParts("vault", { today: { vault: 2 }, recent: { vault: 5 } }), [{ key: "galaxy.today", n: 2 }, { key: "galaxy.week", n: 5 }]);
  assert.deepEqual(hoverParts("vault", { today: { vault: 0, life: 3 } }), []);
});
