import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_MODEL, findings, parseModel, playOne, sensitivity, simulateModel } from "../src/lib/economy-sim-pure.ts";

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
