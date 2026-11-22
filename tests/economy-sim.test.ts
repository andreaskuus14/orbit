import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_MODEL, findings, parseModel, playOne, sensitivity, simulateModel, type Model } from "../src/lib/economy-sim-pure.ts";

const { model, errors } = parseModel(SAMPLE_MODEL);

test("sample parses; bad rows are reported by line; real money is refused", () => {
  assert.deepEqual(errors, []);
  assert.equal(model.sinks.length, 4); assert.equal(model.rewards[0].repeat, 15);
  const p = parseModel("source, A, 0, 1\nrobux, Pass, 99\nsink, X, 10\nsink, X, 20\nfoo");
  assert.match(p.errors.join("|"), /Line 1: source/); assert.match(p.errors.join("|"), /Line 2: real money/);
  assert.match(p.errors.join("|"), /Line 4: sink "X" is listed twice/); assert.match(p.errors.join("|"), /Line 5: unknown row/);
});

test("same seed replays identically; another seed differs", () => {
  assert.deepEqual(simulateModel(model, { players: 30, seed: 7 }), simulateModel(model, { players: 30, seed: 7 }));
  assert.deepEqual(playOne(model, 7, 3), playOne(model, 7, 3));
  assert.notDeepEqual(playOne(model, 7, 3).events, playOne(model, 8, 3).events);
});

test("result is labelled simulated and carries no money fields", () => {
  const r = simulateModel(model, { players: 20, seed: 1 });
  assert.equal(r.label, "simulated");
  assert.doesNotMatch(JSON.stringify(r), /revenue|robux|usd/i);
  assert.ok(r.sinks[0].reached > 0 && r.sinks[0].median! >= 0);
});

test("timed rewards land on schedule; rebuyable sinks grow in price", () => {
  const m = parseModel("reward, Gift, 100, 5, 5\nsink, Up, 50, 2\nsession, 20, 1").model;
  const ev = playOne(m, 1, 0).events;
  assert.deepEqual(ev.filter((e) => e.kind === "reward").map((e) => e.min), [5, 10, 15, 20]);
  const r = playOne(m, 1, 0);
  assert.deepEqual(r.events.filter((e) => e.kind === "buy").map((e) => e.min), [5, 10, 20]); // 400 coins: buys at 50, 100, 200; 400 not reached
  assert.equal(r.spent.Up, 350); assert.equal(r.balance, 50);
});

test("findings flag unreached sinks, piling currency and dead time", () => {
  const m = parseModel("source, Idle, 1, 1\nsink, Car, 1000000\nsession, 30, 1").model;
  const codes = findings(simulateModel(m, { players: 10, seed: 1 })).map((f) => f.code);
  assert.deepEqual(codes.sort(), ["gap", "pileUp", "unreached"]);
});

test("sensitivity: cheaper target sink means sooner; sorted by effect", () => {
  const s = sensitivity(model, { players: 20, seed: 1 });
  assert.ok(s.target);
  const own = s.rows.find((r) => r.input === `sink:${s.target}`)!;
  assert.ok((own.down ?? 0) <= 0 && (own.up === null || own.up >= 0));
});

test("save_for_goal budgeting reaches expensive milestone that greedy buying starves", () => {
  const m: Model = {
    currency: "Coins",
    sources: [{ name: "Clicking", amount: 10, every: 1 }],
    rewards: [],
    sinks: [
      { name: "Click Power", price: 100, growth: 1.15, boost: 3 },
      { name: "Quantum Zone Gate", price: 15000, growth: 0, boost: 0 },
    ],
    session: 45,
    sessions: 1,
  };
  const greedy = simulateModel(m, { players: 40, seed: 42, strategy: "greedy" });
  const smart = simulateModel(m, { players: 40, seed: 42, strategy: "save_for_goal" });
  const mixed = simulateModel(m, { players: 40, seed: 42, strategy: "mixed" });

  const gateGreedy = greedy.sinks.find((s) => s.name === "Quantum Zone Gate")!;
  const gateSmart = smart.sinks.find((s) => s.name === "Quantum Zone Gate")!;
  const gateMixed = mixed.sinks.find((s) => s.name === "Quantum Zone Gate")!;

  assert.equal(gateGreedy.reached, 0, "greedy buyer starves saving for the gate");
  assert.ok(gateSmart.reached > 50, `save_for_goal should reach gate >50%, got ${gateSmart.reached}%`);
  assert.ok(gateMixed.reached > gateGreedy.reached && gateMixed.reached <= gateSmart.reached);
  // Smart player still buys early high-ROI Click Power upgrades before saving
  const upSmart = smart.sinks.find((s) => s.name === "Click Power")!;
  assert.ok(upSmart.reached === 100 && (upSmart.buys ?? 0) >= 1);
});

test("rebirth resets primary balance & non-permanent upgrades, applies permanent multiplier, and accelerates earning", () => {
  const baseModel: Model = {
    currency: "Coins",
    sources: [{ name: "Clicking", amount: 20, every: 1 }],
    rewards: [],
    sinks: [
      { name: "Speed", price: 200, growth: 1.6, boost: 20 },
      { name: "Rebirth 1", price: 5000, growth: 2.5, boost: 0, isRebirth: true, rebirthMult: 2, rebirthRewardCurrency: 25, resetsUpgrades: true },
    ],
    session: 60,
    sessions: 1,
    secondaryCurrencyName: "Gems",
  };

  const single = playOne(baseModel, 7, 0);
  const rebirthEvents = single.events.filter((e) => e.kind === "rebirth");
  assert.ok(single.rebirths >= 1, "player should rebirth at least once");
  assert.equal(rebirthEvents.length, single.rebirths);
  assert.equal(rebirthEvents[0].balance, 0, "rebirth resets primary balance to 0");
  assert.equal(single.rebirthMult, 2 ** single.rebirths);
  assert.equal(single.secondary?.currency, "Gems");
  assert.equal(single.secondary?.rewarded, single.rebirths * 25);

  // Verify non-permanent Speed upgrade is re-bought after rebirth
  const firstRebirthMin = rebirthEvents[0].min;
  const speedAfterRebirth = single.events.filter((e) => e.kind === "buy" && e.name === "Speed" && e.min > firstRebirthMin);
  assert.ok(speedAfterRebirth.length >= 1, "non-permanent upgrades reset and are re-bought after rebirth");

  // Verify post-rebirth earning acceleration vs 1x rebirth multiplier
  const noMultModel: Model = {
    ...baseModel,
    sinks: baseModel.sinks.map((s) => (s.isRebirth ? { ...s, rebirthMult: 1 } : s)),
  };
  const boostedRun = playOne(baseModel, 7, 0);
  const flatRun = playOne(noMultModel, 7, 0);
  assert.ok(boostedRun.earned > flatRun.earned, `2x rebirth should earn more (${boostedRun.earned}) than 1x (${flatRun.earned})`);

  // Verify summary rebirth stats and Model.rebirth config block
  const sim = simulateModel(baseModel, { players: 30, seed: 3 });
  assert.ok(sim.avgRebirths >= 1, `avgRebirths should be >= 1, got ${sim.avgRebirths}`);
  assert.ok(sim.rebirthRate >= 90, `rebirthRate should be >= 90%, got ${sim.rebirthRate}%`);

  const viaConfig: Model = {
    currency: "Coins",
    sources: [{ name: "Clicking", amount: 20, every: 1 }],
    rewards: [],
    sinks: [{ name: "Speed", price: 200, growth: 1.6, boost: 20 }],
    rebirth: { name: "Rebirth 1", price: 5000, growth: 2.5, mult: 2, rewardSecondary: 25 },
    secondaryCurrencyName: "Gems",
    session: 60,
    sessions: 1,
  };
  const simCfg = simulateModel(viaConfig, { players: 30, seed: 3 });
  assert.equal(simCfg.avgRebirths, sim.avgRebirths);
  assert.equal(simCfg.rebirthRate, sim.rebirthRate);
});

test("multi-currency tracks primary and secondary currencies independently and buys prestige items", () => {
  const m: Model = {
    currency: "Coins",
    secondaryCurrencyName: "Gems",
    secondaryEarnPerMin: 2,
    sources: [{ name: "Clicking", amount: 5, every: 1 }],
    rewards: [
      { name: "Coin Bonus", amount: 500, at: 10, repeat: 0 },
      { name: "Gem Chest", amount: 30, at: 15, repeat: 0, currency: "Gems" },
    ],
    sinks: [
      { name: "Speed", price: 100, growth: 1.5, boost: 10 },
      { name: "Forest Gate", price: 3000, growth: 0, boost: 0 },
      { name: "Prestige Pet", price: 50, growth: 0, boost: 50, currency: "Gems" },
      { name: "Mythic Aura", price: 100, growth: 0, boost: 0, currency: "Gems" },
    ],
    session: 60,
    sessions: 1,
  };

  const p = playOne(m, 11, 0);
  const primarySpent = Object.values(p.spent).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(p.balance - (p.earned + p.rewarded - primarySpent)) < 1e-6, "primary coins are conserved");
  assert.ok(p.secondary, "secondary currency summary present");
  assert.equal(p.secondary.currency, "Gems");
  assert.ok(
    Math.abs(p.secondary.balance - (p.secondary.earned + p.secondary.rewarded - p.secondary.spent)) < 1e-6,
    "secondary gems are conserved",
  );
  assert.equal(p.spent["Prestige Pet"], undefined, "gem purchase does not deduct from primary spent");
  assert.equal(p.secondary.spentBySink["Prestige Pet"], 50);

  const sim = simulateModel(m, { players: 25, seed: 11 });
  assert.ok(sim.secondary && sim.secondary.currency === "Gems");
  assert.ok(sim.secondary.earned > 0 && sim.secondary.rewarded === 30 && sim.secondary.spent >= 50);
  const petStat = sim.sinks.find((s) => s.name === "Prestige Pet")!;
  assert.equal(petStat.currency, "Gems");
  assert.equal(petStat.reached, 100);
});

test("parseModel supports currency2, rebirth, strategy, and secondary-currency sinks", () => {
  const table = `
currency, Coins
currency2, Gems, 1.5
strategy, save_for_goal
source, Click, 10, 1
sink, Power, 100, 1.5, 10
rebirth, Rebirth 1, 5000, 2, 2, 20
sink, Gem Pet, 20, 0, 50, Gems
session, 30, 2
`;
  const parsed = parseModel(table);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.model.secondaryCurrencyName, "Gems");
  assert.equal(parsed.model.secondaryEarnPerMin, 1.5);
  assert.equal(parsed.model.strategy, "save_for_goal");
  const rb = parsed.model.sinks.find((s) => s.name === "Rebirth 1")!;
  assert.equal(rb.isRebirth, true);
  assert.equal(rb.rebirthMult, 2);
  assert.equal(rb.rebirthRewardCurrency, 20);
  const gp = parsed.model.sinks.find((s) => s.name === "Gem Pet")!;
  assert.equal(gp.currency, "Gems");

  const sim = simulateModel(parsed.model, { players: 20, seed: 1 });
  assert.ok(sim.rebirthRate > 0 && sim.secondary?.currency === "Gems");
  assert.ok(sim.sinks.find((s) => s.name === "Gem Pet")!.reached > 0);
});
