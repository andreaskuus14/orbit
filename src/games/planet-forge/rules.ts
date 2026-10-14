// Planet Forge: game rules and state transitions. Pure and dependency-free (no React, no canvas, no network),
// so the same code drives the game, validates saves on the server and runs in the tests.

export type Resource = "ore" | "crystal" | "energy";
export const RESOURCES: Resource[] = ["ore", "crystal", "energy"];
export type Bag = Record<Resource, number>;
export type PlanetId = "ferros" | "glacia" | "verdan";
export type PlanetStatus = "untouched" | "industrialized" | "restored" | "unstable";
export type UpgradeId = "laser" | "cargo" | "drill";
export type DevPath = "industry" | "restoration";

export type PlanetDef = { id: PlanetId; name: string; kind: string; orbit: number; speed: number; phase: number; radius: number; yields: Bag };
export type PlanetState = { id: PlanetId; stability: number; industry: number; restoration: number; unstable: boolean; mined: number };
export type Ship = { x: number; y: number; vx: number; vy: number; angle: number };
export type Target = { x: number; y: number } | { planet: PlanetId } | { gate: true } | null;
export type GameState = {
  time: number; ship: Ship; target: Target; inventory: Bag; totals: Bag; upgrades: Record<UpgradeId, number>;
  planets: PlanetState[]; selected: PlanetId | null; objective: number; gate: Bag; gateBuilt: boolean; mineCooldown: number;
};
export type Input = { x: number; y: number; mine: boolean }; // x/y: steering in -1..1 (keyboard); mine: held
export type GameEvent =
  | { type: "mined"; planet: PlanetId; gains: Bag; x: number; y: number }
  | { type: "cargoFull" }
  | { type: "noPlanet" }
  | { type: "status"; planet: PlanetId; from: PlanetStatus; to: PlanetStatus }
  | { type: "objective"; index: number }
  | { type: "upgrade"; id: UpgradeId; tier: number }
  | { type: "gate"; delivered: Bag; done: boolean }
  | { type: "won" };
export type Step = { state: GameState; events: GameEvent[] };
export type ActionResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; reason: string };

// ---------- World ----------
export const WORLD = { w: 1600, h: 1000, sun: { x: 800, y: 500, r: 56 }, gate: { x: 1490, y: 205, r: 44 }, squash: 0.7 };
export const PLANETS: PlanetDef[] = [
  { id: "ferros", name: "Ferros", kind: "Iron world", orbit: 200, speed: 0.034, phase: 0.6, radius: 48, yields: { ore: 1, crystal: 0.15, energy: 0 } },
  { id: "glacia", name: "Glacia", kind: "Ice world", orbit: 325, speed: 0.025, phase: 2.9, radius: 42, yields: { ore: 0.2, crystal: 0.8, energy: 0.1 } },
  { id: "verdan", name: "Verdan", kind: "Ocean world", orbit: 450, speed: 0.018, phase: 5.0, radius: 56, yields: { ore: 0.3, crystal: 0.1, energy: 0.9 } },
];
export const planetDef = (id: PlanetId) => PLANETS.find((p) => p.id === id)!;

const SHIP = { accel: 950, maxSpeed: 300, damping: 2.4, dockGap: 34 };
export const MINE_RANGE = 80; // beyond the planet's surface
export const PULSE = 0.4; // seconds between mining pulses while held
export const GATE_RANGE = 120;
export const UNSTABLE_BELOW = 25; // stability that tips a planet into "unstable"
export const RECOVER_AT = 40; // stability needed to leave "unstable" (hysteresis so it doesn't flicker)
export const MAX_LEVEL = 3;
const BASE_DAMAGE = 0.6; // stability lost per pulse before multipliers

// ---------- Economy ----------
export const UPGRADES: Record<UpgradeId, { name: string; desc: string; tiers: { value: number; label: string; cost: Partial<Bag> }[] }> = {
  laser: { name: "Mining Laser", desc: "More resources from every pulse.", tiers: [
    { value: 1, label: "×1 yield", cost: {} },
    { value: 1.6, label: "×1.6 yield", cost: { ore: 25, crystal: 10 } },
    { value: 2.4, label: "×2.4 yield", cost: { ore: 70, crystal: 35, energy: 30 } },
  ] },
  cargo: { name: "Cargo Hold", desc: "Carry more of each resource.", tiers: [
    { value: 60, label: "60 per resource", cost: {} },
    { value: 150, label: "150 per resource", cost: { ore: 35, energy: 10 } },
    { value: 300, label: "300 per resource", cost: { ore: 90, crystal: 30, energy: 40 } },
  ] },
  drill: { name: "Stabilizer Drill", desc: "Mining damages planets less.", tiers: [
    { value: 1, label: "full damage", cost: {} },
    { value: 0.6, label: "−40% damage", cost: { crystal: 20, energy: 15 } },
    { value: 0.35, label: "−65% damage", cost: { crystal: 50, energy: 45 } },
  ] },
};
export const UPGRADE_IDS: UpgradeId[] = ["laser", "cargo", "drill"];
export const DEV_COST: Record<DevPath, Partial<Bag>[]> = {
  industry: [{ ore: 30, energy: 15 }, { ore: 60, crystal: 10, energy: 40 }, { ore: 100, crystal: 30, energy: 70 }],
  restoration: [{ crystal: 15, energy: 15 }, { crystal: 35, energy: 35 }, { ore: 20, crystal: 60, energy: 60 }],
};
export const GATE_COST: Bag = { ore: 340, crystal: 240, energy: 300 }; // delivered in one or more loads

// ---------- Settings (validated; editable in the Game Lab) ----------
export type Settings = { miningYield: number; upgradeCost: number; planetDamage: number; production: number };
export type SettingSpec = { label: string; help: string; min: number; max: number; step: number; def: number };
export const SETTINGS_SPEC: Record<keyof Settings, SettingSpec> = {
  miningYield: { label: "Mining yield", help: "Resources gained per mining pulse.", min: 0.5, max: 3, step: 0.1, def: 1 },
  upgradeCost: { label: "Upgrade cost", help: "Price multiplier for ship upgrades.", min: 0.5, max: 2, step: 0.1, def: 1 },
  planetDamage: { label: "Planet damage", help: "How fast mining lowers a planet's stability (0 = none).", min: 0, max: 2, step: 0.1, def: 1 },
  production: { label: "Planet production", help: "Output of factories and restored ecosystems.", min: 0.5, max: 3, step: 0.1, def: 1 },
};
export const SETTING_KEYS = Object.keys(SETTINGS_SPEC) as (keyof Settings)[];
export const DEFAULT_SETTINGS: Settings = { miningYield: 1, upgradeCost: 1, planetDamage: 1, production: 1 };

export function validateSettings(raw: unknown): { ok: true; settings: Settings } | { ok: false; errors: Record<string, string> } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!src) return { ok: false, errors: { _: "Settings must be an object" } };
  const errors: Record<string, string> = {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of SETTING_KEYS) {
    const spec = SETTINGS_SPEC[k];
    const v = src[k];
    if (v === undefined) continue;
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) errors[k] = `${spec.label} must be a number`;
    else if (n < spec.min || n > spec.max) errors[k] = `${spec.label} must be between ${spec.min} and ${spec.max}`;
    else out[k] = Math.round(n * 100) / 100;
  }
  for (const k of Object.keys(src)) if (!(k in SETTINGS_SPEC)) errors[k] = `Unknown setting "${k}"`;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: out };
}

// ---------- Helpers ----------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const emptyBag = (): Bag => ({ ore: 0, crystal: 0, energy: 0 });
export const capacity = (s: GameState) => UPGRADES.cargo.tiers[s.upgrades.cargo].value;
export const canAfford = (inv: Bag, cost: Partial<Bag>) => RESOURCES.every((r) => inv[r] >= (cost[r] ?? 0));
export function missing(inv: Bag, cost: Partial<Bag>): Partial<Bag> {
  const out: Partial<Bag> = {};
  for (const r of RESOURCES) if ((cost[r] ?? 0) > inv[r]) out[r] = Math.ceil((cost[r] ?? 0) - inv[r]);
  return out;
}
function pay(inv: Bag, cost: Partial<Bag>) { for (const r of RESOURCES) inv[r] = Math.max(0, inv[r] - (cost[r] ?? 0)); }
/** Adds resources up to the cargo capacity; returns what actually fit. */
function store(inv: Bag, add: Partial<Bag>, cap: number): Bag {
  const got = emptyBag();
  for (const r of RESOURCES) { const before = inv[r]; inv[r] = clamp(before + (add[r] ?? 0), 0, cap); got[r] = inv[r] - before; }
  return got;
}
const clone = (s: GameState): GameState => structuredClone(s);
const planet = (s: GameState, id: PlanetId) => s.planets.find((p) => p.id === id)!;

export function planetPos(def: PlanetDef, time: number) {
  const a = def.phase + def.speed * time;
  return { x: WORLD.sun.x + Math.cos(a) * def.orbit, y: WORLD.sun.y + Math.sin(a) * def.orbit * WORLD.squash };
}
export const distTo = (s: GameState, p: { x: number; y: number }) => Math.hypot(s.ship.x - p.x, s.ship.y - p.y);
export function inRange(s: GameState, id: PlanetId) {
  const def = planetDef(id);
  return distTo(s, planetPos(def, s.time)) <= def.radius + MINE_RANGE;
}
export const nearGate = (s: GameState) => distTo(s, WORLD.gate) <= GATE_RANGE;
/** The planet the ship can mine right now: the selected one if in range, else the nearest in range. */
export function minable(s: GameState): PlanetId | null {
  if (s.selected && inRange(s, s.selected)) return s.selected;
  let best: PlanetId | null = null, bestD = Infinity;
  for (const def of PLANETS) {
    const d = distTo(s, planetPos(def, s.time)) - def.radius;
    if (d <= MINE_RANGE && d < bestD) { best = def.id; bestD = d; }
  }
  return best;
}

// ---------- Planet evolution ----------
export function planetStatus(p: PlanetState): PlanetStatus {
  if (p.unstable) return "unstable";
  if (p.industry > 0) return "industrialized";
  if (p.restoration > 0) return "restored";
  return "untouched";
}

export type Effects = { yieldMult: number; damageMult: number; production: Bag; drift: number; driftTo: number; note: string };
/** What a planet's current state means in play: mining multipliers, passive output per second, stability drift. */
export function planetEffects(p: PlanetState, settings: Settings = DEFAULT_SETTINGS): Effects {
  const def = planetDef(p.id);
  const prod = emptyBag();
  let yieldMult = 1, damageMult = 1, drift = 0.08, driftTo = 100, note = "Untouched. Slowly recovers from mining.";
  if (p.industry > 0) {
    const L = p.industry;
    for (const r of RESOURCES) prod[r] = def.yields[r] * 0.7 * L * settings.production;
    yieldMult = 1.25;
    drift = -0.5; driftTo = 75 - 22 * L; // pollution drags stability down to this level
    note = `Factories ×${L}: +25% mining yield and passive output, but pollution pulls stability down to ${driftTo}.`;
  } else if (p.restoration > 0) {
    const L = p.restoration;
    prod.energy = 0.35 * L * settings.production;
    prod.crystal = def.yields.crystal * 0.25 * L * settings.production;
    damageMult = 0.5;
    drift = 0.6 * L; driftTo = 100;
    note = `Ecosystem ×${L}: renewable energy, mining damage halved, stability regrows.`;
  }
  if (p.unstable) {
    yieldMult *= 0.4;
    for (const r of RESOURCES) prod[r] = 0;
    note = `Unstable: quakes cut mining yield to 40% and stop all production. Recovers at ${RECOVER_AT} stability.`;
  }
  return { yieldMult, damageMult, production: prod, drift, driftTo, note };
}

function applyStability(s: GameState, p: PlanetState, value: number, events: GameEvent[]) {
  const before = planetStatus(p);
  p.stability = clamp(value, 0, 100);
  if (!p.unstable && p.stability < UNSTABLE_BELOW) p.unstable = true;
  else if (p.unstable && p.stability >= RECOVER_AT) p.unstable = false;
  const after = planetStatus(p);
  if (after !== before) events.push({ type: "status", planet: p.id, from: before, to: after });
}

// ---------- Objectives ----------
export const OBJECTIVES: { title: string; hint: string; done: (s: GameState) => boolean }[] = [
  { title: "Mine ore on Ferros", hint: "Fly to the red planet and hold Space (or the Mine button) until you have 20 ore.", done: (s) => s.totals.ore >= 20 },
  { title: "Mine crystal on Glacia", hint: "The icy planet is rich in crystal. Mine 10 crystal.", done: (s) => s.totals.crystal >= 10 },
  { title: "Upgrade your ship", hint: "Open Upgrades (U) and buy any upgrade.", done: (s) => UPGRADE_IDS.some((u) => s.upgrades[u] > 0) },
  { title: "Shape a planet", hint: "Near a planet, build Industry (I) for output and pollution, or Restore it (R) for renewable energy and stability.", done: (s) => s.planets.some((p) => p.industry > 0 || p.restoration > 0) },
  { title: "Expand your cargo hold", hint: "The jump gate needs big loads. Upgrade the Cargo Hold to tier 2.", done: (s) => s.upgrades.cargo >= 1 },
  { title: "Build the jump gate", hint: "Deliver 340 ore, 240 crystal and 300 energy to the gate site (top right): fly there and press B. Several loads are fine.", done: (s) => s.gateBuilt },
];
export const GATE_OBJECTIVE = OBJECTIVES.length - 1;
export const won = (s: GameState) => s.objective >= OBJECTIVES.length;

function advanceObjectives(s: GameState, events: GameEvent[]) {
  while (s.objective < OBJECTIVES.length && OBJECTIVES[s.objective].done(s)) {
    events.push({ type: "objective", index: s.objective });
    s.objective++;
    if (won(s)) events.push({ type: "won" });
  }
}

// ---------- State ----------
export function createInitialState(): GameState {
  const start = planetPos(planetDef("ferros"), 0);
  return {
    time: 0,
    ship: { x: start.x - 150, y: start.y + 60, vx: 0, vy: 0, angle: 0 },
    target: null,
    inventory: { ore: 0, crystal: 0, energy: 10 },
    totals: emptyBag(),
    upgrades: { laser: 0, cargo: 0, drill: 0 },
    planets: PLANETS.map((d) => ({ id: d.id, stability: 100, industry: 0, restoration: 0, unstable: false, mined: 0 })),
    selected: "ferros",
    objective: 0,
    gate: emptyBag(),
    gateBuilt: false,
    mineCooldown: 0,
  };
}

/** Where the ship is heading for its current autopilot target (planets: a docking point on the near side). */
export function targetPoint(s: GameState): { x: number; y: number } | null {
  const t = s.target;
  if (!t) return null;
  if ("planet" in t) {
    const def = planetDef(t.planet);
    const p = planetPos(def, s.time);
    const dx = s.ship.x - p.x, dy = s.ship.y - p.y, d = Math.hypot(dx, dy) || 1;
    const gap = def.radius + SHIP.dockGap;
    return { x: p.x + (dx / d) * gap, y: p.y + (dy / d) * gap };
  }
  if ("gate" in t) return { x: WORLD.gate.x - 70, y: WORLD.gate.y + 40 };
  return { x: t.x, y: t.y };
}

/** Advance the simulation by dt seconds. Never mutates the input state. */
export function step(prev: GameState, input: Input, dtRaw: number, settings: Settings = DEFAULT_SETTINGS): Step {
  const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.1);
  const s = clone(prev);
  const events: GameEvent[] = [];
  s.time += dt;

  // Ship: keyboard thrust cancels autopilot; otherwise steer toward the target, else coast to a stop.
  const sh = s.ship;
  const ix = clamp(input.x, -1, 1), iy = clamp(input.y, -1, 1);
  if (ix || iy) {
    s.target = null;
    const n = Math.hypot(ix, iy) || 1;
    sh.vx += (ix / n) * SHIP.accel * dt;
    sh.vy += (iy / n) * SHIP.accel * dt;
  } else {
    const tp = targetPoint(s);
    if (tp) {
      const dx = tp.x - sh.x, dy = tp.y - sh.y, d = Math.hypot(dx, dy);
      if (d < 4 && s.target && !("planet" in s.target)) { sh.vx = 0; sh.vy = 0; s.target = null; }
      else if (d < 6) { sh.x = tp.x; sh.y = tp.y; sh.vx = 0; sh.vy = 0; } // docked: ride along with the planet
      else {
        const want = Math.min(SHIP.maxSpeed, d * 3.2);
        const dvx = (dx / d) * want - sh.vx, dvy = (dy / d) * want - sh.vy, dv = Math.hypot(dvx, dvy);
        const k = Math.min(1, (SHIP.accel * 1.6 * dt) / (dv || 1));
        sh.vx += dvx * k; sh.vy += dvy * k;
      }
    } else {
      const f = Math.exp(-SHIP.damping * dt);
      sh.vx *= f; sh.vy *= f;
    }
  }
  const sp = Math.hypot(sh.vx, sh.vy);
  if (sp > SHIP.maxSpeed) { sh.vx *= SHIP.maxSpeed / sp; sh.vy *= SHIP.maxSpeed / sp; }
  sh.x = clamp(sh.x + sh.vx * dt, 20, WORLD.w - 20);
  sh.y = clamp(sh.y + sh.vy * dt, 20, WORLD.h - 20);
  if (sp > 8) sh.angle = Math.atan2(sh.vy, sh.vx);

  // Planets: stability drift (pollution or regrowth) and passive production.
  const cap = capacity(s);
  for (const p of s.planets) {
    const fx = planetEffects(p, settings);
    if (fx.drift > 0 && p.stability < fx.driftTo) applyStability(s, p, Math.min(fx.driftTo, p.stability + fx.drift * dt), events);
    else if (fx.drift < 0 && p.stability > fx.driftTo) applyStability(s, p, Math.max(fx.driftTo, p.stability + fx.drift * dt), events);
    const got = store(s.inventory, { ore: fx.production.ore * dt, crystal: fx.production.crystal * dt, energy: fx.production.energy * dt }, cap);
    for (const r of RESOURCES) s.totals[r] += got[r];
  }

  // Mining: one pulse every PULSE seconds while held; the first pulse fires immediately.
  if (!input.mine) s.mineCooldown = 0;
  else {
    const id = minable(s);
    if (!id) { events.push({ type: "noPlanet" }); s.mineCooldown = 0; }
    else {
      s.selected = id;
      s.mineCooldown -= dt;
      let pulses = 0;
      while (s.mineCooldown <= 0 && pulses < 3) { pulses++; s.mineCooldown += PULSE; mineOnce(s, id, settings, events); }
    }
  }

  advanceObjectives(s, events);
  return { state: s, events };
}

/** One mining pulse on a planet in range. Exported for tests; the game calls it through step(). */
export function mineOnce(s: GameState, id: PlanetId, settings: Settings, events: GameEvent[]) {
  const def = planetDef(id), p = planet(s, id), fx = planetEffects(p, settings);
  const cap = capacity(s);
  const laser = UPGRADES.laser.tiers[s.upgrades.laser].value;
  const want: Bag = emptyBag();
  for (const r of RESOURCES) want[r] = def.yields[r] * settings.miningYield * laser * fx.yieldMult;
  if (RESOURCES.every((r) => want[r] <= 0 || s.inventory[r] >= cap)) { events.push({ type: "cargoFull" }); return; }
  const got = store(s.inventory, want, cap);
  for (const r of RESOURCES) s.totals[r] += got[r];
  p.mined += RESOURCES.reduce((a, r) => a + got[r], 0);
  const damage = BASE_DAMAGE * settings.planetDamage * UPGRADES.drill.tiers[s.upgrades.drill].value * fx.damageMult;
  applyStability(s, p, p.stability - damage, events);
  const pos = planetPos(def, s.time);
  events.push({ type: "mined", planet: id, gains: got, x: pos.x, y: pos.y });
}

// ---------- Player actions ----------
export function upgradeCost(id: UpgradeId, tier: number, settings: Settings = DEFAULT_SETTINGS): Partial<Bag> | null {
  const t = UPGRADES[id].tiers[tier];
  if (!t || tier === 0) return null;
  const out: Partial<Bag> = {};
  for (const r of RESOURCES) if (t.cost[r]) out[r] = Math.round(t.cost[r]! * settings.upgradeCost);
  return out;
}

export function buyUpgrade(prev: GameState, id: UpgradeId, settings: Settings = DEFAULT_SETTINGS): ActionResult {
  const next = prev.upgrades[id] + 1;
  const cost = upgradeCost(id, next, settings);
  if (!cost) return { ok: false, reason: `${UPGRADES[id].name} is fully upgraded` };
  if (!canAfford(prev.inventory, cost)) return { ok: false, reason: `Need ${fmtBag(missing(prev.inventory, cost))} more` };
  const s = clone(prev);
  pay(s.inventory, cost);
  s.upgrades[id] = next;
  const events: GameEvent[] = [{ type: "upgrade", id, tier: next }];
  advanceObjectives(s, events);
  return { ok: true, state: s, events };
}

export function devCost(p: PlanetState, path: DevPath): Partial<Bag> | null {
  const level = path === "industry" ? p.industry : p.restoration;
  return DEV_COST[path][level] ?? null;
}
/** Why a development can't happen right now (null = allowed). Industry and restoration are exclusive paths. */
export function devBlocker(s: GameState, id: PlanetId, path: DevPath): string | null {
  const p = planet(s, id), name = planetDef(id).name;
  if (path === "industry" && p.restoration > 0) return `${name} is a restored world. Factories would undo it.`;
  if (path === "restoration" && p.industry > 0) return `Decommission ${name}'s factories before restoring it.`;
  const cost = devCost(p, path);
  if (!cost) return `${path === "industry" ? "Industry" : "Restoration"} is at max level`;
  if (!inRange(s, id)) return `Fly closer to ${name}`;
  if (!canAfford(s.inventory, cost)) return `Need ${fmtBag(missing(s.inventory, cost))} more`;
  return null;
}

export function develop(prev: GameState, id: PlanetId, path: DevPath): ActionResult {
  const blocked = devBlocker(prev, id, path);
  if (blocked) return { ok: false, reason: blocked };
  const s = clone(prev);
  const p = planet(s, id);
  const before = planetStatus(p);
  pay(s.inventory, devCost(p, path)!);
  if (path === "industry") p.industry++;
  else { p.restoration++; p.stability = Math.min(100, p.stability + 10); } // planting gives an immediate boost
  const events: GameEvent[] = [];
  applyStability(s, p, p.stability, events);
  const after = planetStatus(p);
  if (after !== before && !events.some((e) => e.type === "status" && e.planet === id)) events.push({ type: "status", planet: id, from: before, to: after });
  advanceObjectives(s, events);
  return { ok: true, state: s, events };
}

/** Removes one factory level: refunds 30% of that level's ore. The only way back from heavy industry. */
export function decommission(prev: GameState, id: PlanetId): ActionResult {
  const p0 = planet(prev, id);
  if (p0.industry === 0) return { ok: false, reason: `${planetDef(id).name} has no factories` };
  if (!inRange(prev, id)) return { ok: false, reason: `Fly closer to ${planetDef(id).name}` };
  const s = clone(prev);
  const p = planet(s, id);
  const before = planetStatus(p);
  p.industry--;
  store(s.inventory, { ore: Math.round((DEV_COST.industry[p.industry].ore ?? 0) * 0.3) }, capacity(s));
  const events: GameEvent[] = [];
  const after = planetStatus(p);
  if (after !== before) events.push({ type: "status", planet: id, from: before, to: after });
  return { ok: true, state: s, events };
}

export const gateRemaining = (s: GameState): Bag => {
  const out = emptyBag();
  for (const r of RESOURCES) out[r] = Math.max(0, GATE_COST[r] - s.gate[r]);
  return out;
};
export const gateProgress = (s: GameState) =>
  RESOURCES.reduce((a, r) => a + s.gate[r], 0) / RESOURCES.reduce((a, r) => a + GATE_COST[r], 0);

export function gateBlocker(s: GameState): string | null {
  if (s.gateBuilt) return "The gate is already built";
  if (s.objective < GATE_OBJECTIVE) return "Finish the earlier objectives first";
  if (!nearGate(s)) return "Fly to the gate site (top right)";
  const rem = gateRemaining(s);
  if (RESOURCES.every((r) => rem[r] <= 0 || s.inventory[r] < 1)) return `Bring ${fmtBag(rem)}`;
  return null;
}
/** Delivers whatever the gate still needs from the cargo; completes the gate when everything is in. */
export function buildGate(prev: GameState): ActionResult {
  const blocked = gateBlocker(prev);
  if (blocked) return { ok: false, reason: blocked };
  const s = clone(prev);
  const rem = gateRemaining(s);
  const delivered = emptyBag();
  for (const r of RESOURCES) {
    delivered[r] = Math.min(rem[r], s.inventory[r]);
    s.inventory[r] -= delivered[r];
    s.gate[r] += delivered[r];
  }
  s.gateBuilt = RESOURCES.every((r) => s.gate[r] >= GATE_COST[r] - 1e-9);
  const events: GameEvent[] = [{ type: "gate", delivered, done: s.gateBuilt }];
  advanceObjectives(s, events);
  return { ok: true, state: s, events };
}

export function fmtBag(b: Partial<Bag>) {
  return RESOURCES.filter((r) => b[r]).map((r) => `${Math.ceil(b[r]!)} ${r}`).join(", ") || "nothing";
}

// ---------- Save format (versioned) ----------
export const SAVE_FORMAT = "orbit.planet-forge";
export const SAVE_VERSION = 1;
export type SaveFile = { format: typeof SAVE_FORMAT; version: number; savedAt: string; settings: Settings; state: GameState };

export function serialize(s: GameState, settings: Settings, now = new Date()): SaveFile {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: now.toISOString(), settings, state: clone(s) };
}

class SaveError extends Error {}
const obj = (v: unknown, what: string) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new SaveError(`${what} is missing`);
  return v as Record<string, unknown>;
};
const num = (v: unknown, what: string, lo: number, hi: number) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SaveError(`${what} is not a number`);
  return clamp(v, lo, hi);
};
const int = (v: unknown, what: string, lo: number, hi: number) => Math.round(num(v, what, lo, hi));

/** Validates an untrusted save. Repairs out-of-range numbers (with a notice) and rejects anything structurally wrong. */
export function parseSave(raw: unknown, current: Settings = DEFAULT_SETTINGS):
  { ok: true; state: GameState; settings: Settings; notices: string[] } | { ok: false; error: string } {
  try {
    const f = obj(raw, "Save");
    if (f.format !== SAVE_FORMAT) throw new SaveError("This is not a Planet Forge save");
    if (typeof f.version !== "number") throw new SaveError("Save version is missing");
    if (f.version > SAVE_VERSION) throw new SaveError(`This save is from a newer version (v${f.version})`);
    const notices: string[] = [];
    const st = obj(f.state, "Game state");
    const ship = obj(st.ship, "Ship");
    const upgradesRaw = obj(st.upgrades, "Upgrades");
    const upgrades = { laser: 0, cargo: 0, drill: 0 } as Record<UpgradeId, number>;
    for (const u of UPGRADE_IDS) upgrades[u] = int(upgradesRaw[u], `Upgrade ${u}`, 0, UPGRADES[u].tiers.length - 1);
    const cap = UPGRADES.cargo.tiers[upgrades.cargo].value;
    const bag = (v: unknown, what: string, hi: number) => {
      const o = obj(v, what);
      const b = emptyBag();
      for (const r of RESOURCES) b[r] = num(o[r], `${what} ${r}`, 0, hi);
      return b;
    };
    const invRaw = obj(st.inventory, "Inventory");
    if (RESOURCES.some((r) => typeof invRaw[r] === "number" && (invRaw[r] as number) > cap)) notices.push(`Cargo was over capacity and was trimmed to ${cap}.`);
    const inventory = bag(st.inventory, "Inventory", cap);
    if (!Array.isArray(st.planets)) throw new SaveError("Planets are missing");
    const planets: PlanetState[] = PLANETS.map((def) => {
      const matches = (st.planets as unknown[]).filter((p) => p && typeof p === "object" && (p as { id?: unknown }).id === def.id);
      if (matches.length !== 1) throw new SaveError(`Planet ${def.name} is missing or duplicated`);
      const p = obj(matches[0], def.name);
      const industry = int(p.industry, `${def.name} industry`, 0, MAX_LEVEL);
      const restoration = int(p.restoration, `${def.name} restoration`, 0, MAX_LEVEL);
      if (industry > 0 && restoration > 0) throw new SaveError(`${def.name} can't be both industrial and restored`);
      const stability = num(p.stability, `${def.name} stability`, 0, 100);
      if (typeof p.unstable !== "boolean") throw new SaveError(`${def.name} instability flag is missing`);
      // The flag must agree with the hysteresis band; fix it if a hand-edited save says otherwise.
      const unstable = stability < UNSTABLE_BELOW ? true : stability >= RECOVER_AT ? false : p.unstable;
      return { id: def.id, stability, industry, restoration, unstable, mined: num(p.mined, `${def.name} mined`, 0, 1e9) };
    });
    if ((st.planets as unknown[]).length !== PLANETS.length) throw new SaveError("Unexpected planets in save");
    const sel = st.selected;
    const selected = sel === null || PLANETS.some((d) => d.id === sel) ? (sel as PlanetId | null) : null;
    if (typeof st.gateBuilt !== "boolean") throw new SaveError("Gate flag is missing");
    const gateRaw = obj(st.gate, "Gate");
    const gate = emptyBag();
    for (const r of RESOURCES) gate[r] = num(gateRaw[r], `Gate ${r}`, 0, GATE_COST[r]);
    const state: GameState = {
      time: num(st.time, "Time", 0, 1e7),
      ship: {
        x: num(ship.x, "Ship x", 20, WORLD.w - 20), y: num(ship.y, "Ship y", 20, WORLD.h - 20),
        vx: num(ship.vx, "Ship vx", -1000, 1000), vy: num(ship.vy, "Ship vy", -1000, 1000), angle: num(ship.angle, "Ship angle", -10, 10),
      },
      target: null, // autopilot isn't resumed after loading
      inventory,
      totals: bag(st.totals, "Totals", 1e9),
      upgrades, planets, selected,
      objective: int(st.objective, "Objective", 0, OBJECTIVES.length),
      gate,
      gateBuilt: st.gateBuilt,
      mineCooldown: 0,
    };
    if (state.gateBuilt !== (state.objective >= OBJECTIVES.length)) throw new SaveError("Objective progress doesn't match the gate");
    if (state.gateBuilt !== RESOURCES.every((r) => gate[r] >= GATE_COST[r] - 1e-9)) throw new SaveError("Gate materials don't match the gate");
    // Settings the save was played with vs. now: explain economy changes rather than silently applying them.
    const vs = validateSettings(f.settings ?? {});
    const saved = vs.ok ? vs.settings : DEFAULT_SETTINGS;
    for (const k of SETTING_KEYS) {
      if (saved[k] !== current[k]) notices.push(`${SETTINGS_SPEC[k].label} changed since this save (×${saved[k]} → ×${current[k]}). Your resources and planets are kept; the new value applies from now on.`);
    }
    return { ok: true, state, settings: saved, notices };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    return { ok: false, error: "The save is damaged" };
  }
}
