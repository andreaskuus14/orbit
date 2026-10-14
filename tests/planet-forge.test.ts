import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState, step, mineOnce, buyUpgrade, develop, decommission, buildGate, planetStatus, planetEffects,
  parseSave, serialize, validateSettings, upgradeCost, capacity, planetPos, planetDef, minable,
  DEFAULT_SETTINGS, GATE_COST, OBJECTIVES, UNSTABLE_BELOW, RECOVER_AT, WORLD,
  type GameState, type PlanetId, type GameEvent,
} from "../src/games/planet-forge/rules.ts";

const S = DEFAULT_SETTINGS;
const idle = { x: 0, y: 0, mine: false };
/** Park the ship right next to a planet (at its current orbital position). */
function dockAt(s: GameState, id: PlanetId): GameState {
  const p = planetPos(planetDef(id), s.time);
  return { ...s, ship: { ...s.ship, x: p.x + planetDef(id).radius + 20, y: p.y, vx: 0, vy: 0 }, selected: id };
}
const planet = (s: GameState, id: PlanetId) => s.planets.find((p) => p.id === id)!;
const rich = (s: GameState, n = 1000): GameState => ({ ...s, upgrades: { ...s.upgrades, cargo: 2 }, inventory: { ore: n, crystal: n, energy: n } });

test("mining yields the planet's resources and costs stability", () => {
  const s = dockAt(createInitialState(), "ferros");
  const events: GameEvent[] = [];
  const next = structuredClone(s);
  mineOnce(next, "ferros", S, events);
  assert.equal(next.inventory.ore, 1);
  assert.ok(Math.abs(next.inventory.crystal - 0.15) < 1e-9);
  assert.equal(next.totals.ore, 1);
  assert.ok(planet(next, "ferros").stability < 100);
  assert.equal(events[0].type, "mined");
  assert.equal(s.inventory.ore, 0, "the original state is untouched");
});

test("holding mine in range produces pulses through step(); out of range does nothing", () => {
  let s = dockAt(createInitialState(), "ferros");
  for (let i = 0; i < 30; i++) s = step(s, { x: 0, y: 0, mine: true }, 0.1, S).state; // 3 s at one pulse per 0.4 s
  assert.ok(s.inventory.ore >= 7 && s.inventory.ore <= 9, `ore ${s.inventory.ore}`);
  let far = createInitialState();
  far = { ...far, ship: { ...far.ship, x: 30, y: 30 } };
  const r = step(far, { x: 0, y: 0, mine: true }, 0.1, S);
  assert.equal(r.state.inventory.ore, 0);
  assert.ok(r.events.some((e) => e.type === "noPlanet"));
  assert.equal(minable(far), null);
});

test("resources are bounded by cargo capacity and full cargo stops mining without damage", () => {
  let s = dockAt(createInitialState(), "ferros");
  s = { ...s, inventory: { ore: 59.5, crystal: 60, energy: 10 } };
  const next = structuredClone(s);
  mineOnce(next, "ferros", S, []);
  assert.equal(next.inventory.ore, capacity(next));
  const full = structuredClone(next);
  const stab = planet(full, "ferros").stability;
  const ev: GameEvent[] = [];
  mineOnce(full, "ferros", S, ev);
  assert.equal(ev[0].type, "cargoFull");
  assert.equal(planet(full, "ferros").stability, stab);
});

test("settings scale mining yield and damage", () => {
  const s = dockAt(createInitialState(), "ferros");
  const a = structuredClone(s), b = structuredClone(s);
  mineOnce(a, "ferros", { ...S, miningYield: 2, planetDamage: 0 }, []);
  mineOnce(b, "ferros", S, []);
  assert.equal(a.inventory.ore, 2);
  assert.equal(planet(a, "ferros").stability, 100);
  assert.ok(planet(b, "ferros").stability < 100);
});

test("upgrades require resources, charge them, and raise tiers up to the max", () => {
  const s = createInitialState();
  const fail = buyUpgrade(s, "laser", S);
  assert.equal(fail.ok, false);
  assert.match((fail as { reason: string }).reason, /Need .*ore/);
  const r = buyUpgrade(rich(s), "laser", S);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.state.upgrades.laser, 1);
  assert.equal(r.state.inventory.ore, 1000 - 25);
  const r2 = buyUpgrade(r.state, "laser", S);
  assert.ok(r2.ok);
  const r3 = buyUpgrade((r2 as { state: GameState }).state, "laser", S);
  assert.equal(r3.ok, false);
  assert.match((r3 as { reason: string }).reason, /fully upgraded/);
  assert.deepEqual(upgradeCost("laser", 1, { ...S, upgradeCost: 2 }), { ore: 50, crystal: 20 });
});

test("upgrades change gameplay: laser yield, cargo capacity, drill damage", () => {
  const base = dockAt(createInitialState(), "ferros");
  const up: GameState = { ...base, upgrades: { laser: 2, cargo: 1, drill: 2 } };
  const a = structuredClone(base), b = structuredClone(up);
  mineOnce(a, "ferros", S, []); mineOnce(b, "ferros", S, []);
  assert.equal(b.inventory.ore, 2.4);
  assert.equal(capacity(b), 150);
  assert.ok(100 - planet(b, "ferros").stability < 100 - planet(a, "ferros").stability);
});

test("heavy mining tips a planet into unstable, which cuts yield; recovery needs the higher threshold", () => {
  let s = dockAt(createInitialState(), "ferros");
  s = { ...s, upgrades: { ...s.upgrades, cargo: 2 } };
  const events: GameEvent[] = [];
  const m = structuredClone(s);
  while (planet(m, "ferros").stability >= UNSTABLE_BELOW) { mineOnce(m, "ferros", S, events); m.inventory = { ore: 0, crystal: 0, energy: 0 }; }
  assert.equal(planetStatus(planet(m, "ferros")), "unstable");
  assert.ok(events.some((e) => e.type === "status" && e.to === "unstable"));
  assert.equal(planetEffects(planet(m, "ferros")).yieldMult, 0.4);
  const before = m.inventory.ore;
  mineOnce(m, "ferros", S, []);
  assert.ok(Math.abs(m.inventory.ore - before - 0.4) < 1e-9);
  // Untouched planets regrow slowly; it stays unstable until RECOVER_AT, not just above UNSTABLE_BELOW.
  planet(m, "ferros").stability = UNSTABLE_BELOW + 5;
  const r = step(m, idle, 0.1, S).state;
  assert.equal(planet(r, "ferros").unstable, true);
  planet(m, "ferros").stability = RECOVER_AT - 0.001;
  let t = m;
  for (let i = 0; i < 5; i++) t = step(t, idle, 0.1, S).state;
  assert.equal(planet(t, "ferros").unstable, false);
});

test("industry: costs resources, needs proximity, produces passively and pollutes stability down", () => {
  const s = rich(createInitialState());
  assert.equal(develop({ ...s, ship: { ...s.ship, x: 30, y: 30 } }, "ferros", "industry").ok, false);
  const r = develop(dockAt(s, "ferros"), "ferros", "industry");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(planetStatus(planet(r.state, "ferros")), "industrialized");
  assert.equal(r.state.inventory.ore, 1000 - 30);
  assert.ok(r.events.some((e) => e.type === "status" && e.to === "industrialized"));
  let t = { ...r.state, inventory: { ore: 0, crystal: 0, energy: 0 } };
  for (let i = 0; i < 100; i++) t = step(t, idle, 0.1, S).state; // 10 s
  assert.ok(t.inventory.ore > 6, `passive ore ${t.inventory.ore}`);
  assert.ok(planet(t, "ferros").stability < 100);
  // Level 3 industry drives a planet unstable on its own.
  let L3 = r.state;
  for (let i = 0; i < 2; i++) L3 = (develop(rich(L3), "ferros", "industry") as { state: GameState }).state;
  assert.equal(planet(L3, "ferros").industry, 3);
  for (let i = 0; i < 2000; i++) L3 = step(L3, idle, 0.1, S).state;
  assert.equal(planetStatus(planet(L3, "ferros")), "unstable");
  assert.equal(planetEffects(planet(L3, "ferros")).production.ore, 0, "unstable planets stop producing");
});

test("restoration: exclusive with industry, regrows stability, halves damage, renewable energy", () => {
  const s = dockAt(rich(createInitialState()), "verdan");
  const ind = (develop(s, "verdan", "industry") as { state: GameState }).state;
  const blocked = develop(ind, "verdan", "restoration");
  assert.equal(blocked.ok, false);
  assert.match((blocked as { reason: string }).reason, /Decommission/);
  const dec = decommission(ind, "verdan");
  assert.ok(dec.ok);
  const back = (dec as { state: GameState }).state;
  assert.equal(planetStatus(planet(back, "verdan")), "untouched");
  const r = develop(back, "verdan", "restoration");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(planetStatus(planet(r.state, "verdan")), "restored");
  assert.equal(develop(r.state, "verdan", "industry").ok, false);
  const fx = planetEffects(planet(r.state, "verdan"));
  assert.equal(fx.damageMult, 0.5);
  assert.ok(fx.production.energy > 0);
  const low = structuredClone(r.state);
  planet(low, "verdan").stability = 30;
  let t = low;
  for (let i = 0; i < 100; i++) t = step(t, idle, 0.1, S).state;
  assert.ok(planet(t, "verdan").stability > 34);
});

test("objectives advance in order and the gate ends the session", () => {
  let s = rich(createInitialState());
  s = { ...s, totals: { ore: 20, crystal: 12, energy: 0 } };
  s = (buyUpgrade(s, "drill", S) as { state: GameState }).state;
  assert.equal(s.objective, 3, "ore, crystal and upgrade done");
  assert.equal(buildGate(s).ok, false, "gate needs the earlier objectives");
  s = (develop(dockAt(s, "glacia"), "glacia", "restoration") as { state: GameState }).state;
  assert.equal(s.objective, 5, "cargo tier is already 2 here, so that objective completes too");
  const far = buildGate(s);
  assert.equal(far.ok, false);
  assert.match((far as { reason: string }).reason, /gate site/);
  const atGate = { ...s, ship: { ...s.ship, x: WORLD.gate.x - 60, y: WORLD.gate.y + 40 } };
  const empty = buildGate({ ...atGate, inventory: { ore: 0, crystal: 0, energy: 0 } });
  assert.match((empty as { reason: string }).reason, /Bring/);
  const part = buildGate({ ...atGate, inventory: { ore: 100, crystal: 10, energy: 0 } });
  assert.ok(part.ok);
  if (!part.ok) return;
  assert.equal(part.state.gateBuilt, false, "a partial load doesn't finish the gate");
  assert.deepEqual(part.state.gate, { ore: 100, crystal: 10, energy: 0 });
  assert.deepEqual(part.state.inventory, { ore: 0, crystal: 0, energy: 0 });
  const r = buildGate({ ...part.state, inventory: atGate.inventory });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.state.gateBuilt, true);
  assert.equal(r.state.objective, OBJECTIVES.length);
  assert.ok(r.events.some((e) => e.type === "won"));
  assert.equal(r.state.inventory.ore, 1000 - (GATE_COST.ore - 100), "only what was still needed is taken");
});

test("ship moves with input, follows autopilot to a planet and stays inside the world", () => {
  let s = createInitialState();
  const x0 = s.ship.x;
  for (let i = 0; i < 10; i++) s = step(s, { x: 1, y: 0, mine: false }, 0.05, S).state;
  assert.ok(s.ship.x > x0);
  s = { ...s, target: { planet: "glacia" } };
  for (let i = 0; i < 200; i++) s = step(s, idle, 0.05, S).state;
  assert.equal(minable({ ...s, selected: null }), "glacia");
  let edge: GameState = { ...s, ship: { ...s.ship, x: 25, y: 25 }, target: null };
  for (let i = 0; i < 20; i++) edge = step(edge, { x: -1, y: -1, mine: false }, 0.05, S).state;
  assert.ok(edge.ship.x >= 20 && edge.ship.y >= 20);
});

test("save round-trips and invalid saves are rejected or repaired", () => {
  const s = rich(createInitialState(), 50);
  const file = JSON.parse(JSON.stringify(serialize(s, S)));
  const ok = parseSave(file, S);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.deepEqual(ok.state.inventory, s.inventory);
  assert.deepEqual(ok.notices, []);

  assert.equal(parseSave(null).ok, false);
  assert.equal(parseSave({ ...file, format: "other" }).ok, false);
  const newer = parseSave({ ...file, version: 99 });
  assert.match((newer as { error: string }).error, /newer version/);
  const nan = structuredClone(file); nan.state.inventory.ore = "lots";
  assert.match((parseSave(nan) as { error: string }).error, /not a number/);
  const dup = structuredClone(file); dup.state.planets[1].id = "ferros";
  assert.equal(parseSave(dup).ok, false);
  const both = structuredClone(file); both.state.planets[0].industry = 1; both.state.planets[0].restoration = 1;
  assert.equal(parseSave(both).ok, false);
  const cheat = structuredClone(file); cheat.state.gateBuilt = true;
  assert.equal(parseSave(cheat).ok, false, "gate flag must match objective progress");
  const cheat2 = structuredClone(file); cheat2.state.gateBuilt = true; cheat2.state.objective = OBJECTIVES.length;
  assert.equal(parseSave(cheat2).ok, false, "gate flag must match delivered materials");

  const over = structuredClone(file); over.state.upgrades.cargo = 0; over.state.inventory.ore = 9999; over.state.planets[0].stability = 500;
  const fixed = parseSave(over);
  assert.ok(fixed.ok);
  if (!fixed.ok) return;
  assert.equal(fixed.state.inventory.ore, 60);
  assert.equal(fixed.state.planets[0].stability, 100);
  assert.ok(fixed.notices.some((n) => /trimmed/.test(n)));

  const changed = parseSave(file, { ...S, miningYield: 2 });
  assert.ok(changed.ok && changed.notices.some((n) => /Mining yield changed/.test(n)));
});

test("settings validation accepts in-range numbers and rejects bad input", () => {
  assert.deepEqual(validateSettings({}), { ok: true, settings: DEFAULT_SETTINGS });
  const ok = validateSettings({ miningYield: "1.5", planetDamage: 0 });
  assert.ok(ok.ok && ok.settings.miningYield === 1.5 && ok.settings.planetDamage === 0);
  const bad = validateSettings({ miningYield: 50, upgradeCost: "x", hack: 1 });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.ok(bad.errors.miningYield && bad.errors.upgradeCost && bad.errors.hack);
  assert.equal(validateSettings([1]).ok, false);
});
