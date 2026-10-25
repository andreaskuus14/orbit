import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREAS, AREA_INFO, AUTO_CONFIRM, DEFAULT_LEVELS, LIMIT_DEFAULTS, autonomyAllows, autonomyDefaults, autoPush, commitmentIn, doneToday, nightOff,
  parseAutonomy, patchLimits, pickAuto, setLevel, type Area, type AutonomyState,
} from "../src/lib/autonomy-pure.ts";
import { decide, TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { planNight, NIGHT_DEFAULTS, type PlanInput } from "../src/lib/night-pure.ts";
import { validate } from "../src/lib/ledger-pure.ts";

// What ORBIT did on its own before Autonomy existed: these ran unattended (night shift, scout, sleep loop, deal hunt, calls).
const RAN_ALONE_TODAY: Area[] = ["research", "memory", "studio-prepare", "business-drafts", "goals", "night-shift", "deals", "calls"];

test("defaults pin today's behaviour: owner clicks work everywhere, unattended work only where it already ran, no auto anywhere", () => {
  for (const a of AREAS) {
    assert.equal(autonomyAllows(a, "owner").ok, true, a);
    assert.equal(autonomyAllows(a, "background").ok, RAN_ALONE_TODAY.includes(a), a);
    assert.equal(autonomyAllows(a, "auto", { doneToday: 0, known: true, text: "hi" }).ok, false, a); // rule 6: never without a click
    assert.notEqual(DEFAULT_LEVELS[a], "auto", a);
  }
  assert.deepEqual(parseAutonomy("").levels, DEFAULT_LEVELS);
  assert.deepEqual(parseAutonomy("not json"), autonomyDefaults());
  assert.deepEqual(nightOff(DEFAULT_LEVELS), []);
  assert.deepEqual(nightOff(undefined), []);
});

test("defaults pin policy decide(): identical verdicts with and without the default levels, for every CORE tool", () => {
  const qs = ["hello", "remember I like tea", "make 2 images of a fox", "look into hooks tonight", "schedule my approved clips", "create a goal to ship v2", "ask atlas to research cats"];
  const ctxs: Partial<PolicyCtx>[] = [{}, { stopAll: true }, { attach: true }, { pins: true }, { steps: ["You called fetch_url {}\nRESULT:\nx"] }];
  for (const tool of [...Object.keys(TIERS), "send_email"]) for (const question of qs) for (const o of ctxs) {
    const c: PolicyCtx = { stopAll: false, attach: false, pins: false, steps: [], question, ...o };
    assert.deepEqual(decide(tool, {}, { ...c, autonomy: DEFAULT_LEVELS }), decide(tool, {}, c), `${tool} / ${question}`);
  }
});

test("defaults pin the night planner: same queue with the default off-list", () => {
  const i: PlanInput = { tonight: [{ id: "t1", text: "x", agent: "atlas", by: "owner", at: "" }], goals: [], followups: [{ id: "p1", name: "Cafe" }], drafted: {}, nicheDue: true, deals: 2, handled: [], now: Date.parse("2026-07-02T22:30:00Z"), today: "2026-07-03" };
  assert.deepEqual(planNight({ ...i, off: nightOff(DEFAULT_LEVELS) }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }), planNight(i, NIGHT_DEFAULTS, { calls: 0, ms: 0 }));
  const off = nightOff({ ...DEFAULT_LEVELS, research: "ask", "business-drafts": "off" });
  assert.deepEqual(off.sort(), ["business", "niche", "research"]);
  assert.deepEqual(planNight({ ...i, off }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "deals", "clips"]);
});

test("Off refuses even the owner's ask; Ask stops unattended work only", () => {
  const c: PolicyCtx = { stopAll: false, attach: false, pins: false, steps: [], question: "remember I like tea" };
  assert.equal(decide("save_memory", {}, c).allow, true);
  assert.match(decide("save_memory", {}, { ...c, autonomy: { memory: "off" } }).reason, /Memory tidy-up is Off/);
  assert.equal(decide("web_search", { query: "x" }, { ...c, autonomy: { research: "off" } }).allow, true); // reads aren't mapped
  assert.equal(autonomyAllows("deals", "background", { levels: { deals: "ask" } }).ok, false);
  assert.equal(autonomyAllows("deals", "owner", { levels: { deals: "ask" } }).ok, true);
  assert.equal(autonomyAllows("night-shift", "background", { levels: { "night-shift": "do" }, stopAll: true }).ok, false);
});

test("setLevel: allowed levels only, auto needs the exact typed phrase, Higgsfield can never be auto", () => {
  const s = autonomyDefaults();
  assert.match(setLevel(s, "higgsfield-spend", "auto", "anything") as string, /can be: Off, Ask/);
  assert.match(setLevel(s, "business-send", "do", "") as string, /can be/);
  assert.match(setLevel(s, "business-send", "auto", "yes") as string, /Type "SEND EMAIL WITHOUT ME"/);
  assert.match(setLevel(s, "nope", "off", "") as string, /Unknown area/);
  const on = setLevel(s, "business-send", "auto", AUTO_CONFIRM["business-send"]) as AutonomyState;
  assert.equal(on.levels["business-send"], "auto");
  assert.equal(s.levels["business-send"], "ask"); // not mutated
  // a hand-edited file can't grant what the UI can't
  assert.equal(parseAutonomy(JSON.stringify({ levels: { "higgsfield-spend": "auto", research: "auto", calls: "ask" } })).levels["higgsfield-spend"], "ask");
  assert.equal(parseAutonomy(JSON.stringify({ levels: { research: "auto" } })).levels.research, "do");
  assert.equal(autonomyAllows("higgsfield-spend", "auto", { levels: { "higgsfield-spend": "auto" as never }, doneToday: 0, known: true }).ok, false);
  // leaving auto drops what was queued for that area
  const q = { ...on, pending: [{ id: "1", area: "business-send" as const, ref: "p", seen: "s", label: "l", at: "", dueAt: "" }] };
  assert.deepEqual((setLevel(q, "business-send", "ask", "") as AutonomyState).pending, []);
});

test("auto limits: cap, Stop-all, known recipients, no prices/payments/contracts/promises", () => {
  const levels = { ...DEFAULT_LEVELS, "business-send": "auto" as const };
  const base = { levels, limits: LIMIT_DEFAULTS, doneToday: 0, known: true, text: "Hi! I made a short idea for your cafe's Instagram. Want to see it?" };
  assert.equal(autonomyAllows("business-send", "auto", base).ok, true);
  assert.match(autonomyAllows("business-send", "auto", { ...base, doneToday: 3 }).why, /limit \(3\)/);
  assert.equal(autonomyAllows("business-send", "auto", { ...base, doneToday: undefined }).ok, false); // unknown count fails closed
  assert.match(autonomyAllows("business-send", "auto", { ...base, stopAll: true }).why, /Stop-all/);
  assert.match(autonomyAllows("business-send", "auto", { ...base, known: false }).why, /existing BUSINESS prospects/);
  for (const t of ["It costs €200", "Only 99 EUR a month", "our price is low", "send the invoice", "sign the contract", "I will deliver by Friday", "we'll do it", "20% off", "$50"])
    assert.notEqual(commitmentIn(t), "", t);
  for (const t of ["Hi, I liked your menu. Want to see a short idea?", "Design ideas for your shop", "Appreciate your time"]) assert.equal(commitmentIn(t), "", t);
  assert.match(autonomyAllows("business-send", "auto", { ...base, text: "It's only €50" }).why, /always need you/);
});

test("pickAuto: once per target, cap counts pending and today's, nothing unless auto", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const c = (ref: string, text = "Hi, a short idea for you") => ({ ref, seen: "v", label: ref, text });
  const s: AutonomyState = { ...autonomyDefaults(), levels: { ...DEFAULT_LEVELS, "business-send": "auto" }, limits: { sendPerDay: 2, publishPerDay: 1 } };
  assert.deepEqual(pickAuto(autonomyDefaults(), "business-send", [c("a")], now, false), []);
  assert.deepEqual(pickAuto(s, "business-send", [c("a"), c("b", "pay €5"), c("c"), c("d")], now, false).map((x) => x.ref), ["a", "c"]);
  assert.deepEqual(pickAuto(s, "business-send", [c("a")], now, true), []);
  const used: AutonomyState = { ...s, done: [{ area: "business-send", ref: "a", at: "2026-10-25T08:00:00Z" }, { area: "business-send", ref: "z", at: "2026-10-23T08:00:00Z" }] };
  assert.equal(doneToday(used, "business-send", now), 1);
  assert.deepEqual(pickAuto(used, "business-send", [c("a"), c("b"), c("c")], now, false).map((x) => x.ref), ["b"]);
  const pend: AutonomyState = { ...s, pending: [{ id: "1", area: "business-send", ref: "q", seen: "", label: "", at: "", dueAt: "" }] };
  assert.deepEqual(pickAuto(pend, "business-send", [c("q"), c("b"), c("c")], now, false).map((x) => x.ref), ["b"]);
});

test("limits, pushes and ledger events carry no text", () => {
  assert.deepEqual(patchLimits({ sendPerDay: 5 }, LIMIT_DEFAULTS), { sendPerDay: 5, publishPerDay: 1 });
  assert.match(patchLimits({ sendPerDay: 0 }, LIMIT_DEFAULTS) as string, /1-20/);
  assert.match(patchLimits({ publishPerDay: 9 }, LIMIT_DEFAULTS) as string, /1-5/);
  assert.equal(autoPush("business-send", "done").title, "ORBIT sent an email");
  assert.equal(autoPush("studio-publish", "queued", 2).title, "ORBIT will publish 2 Shorts in 10 min");
  const ev = (type: string, data: object) => validate({ id: "e1", at: "2026-10-25T10:00:00Z", type, planet: "core", data });
  assert.ok("ok" in ev("autonomy.change", { area: "business-send", from: "ask", to: "auto" }));
  assert.ok("ok" in ev("autonomy.act", { area: "studio-publish", action: "publish", ref: "job/clip" }));
  assert.ok("error" in ev("autonomy.change", { area: "nope", from: "ask", to: "auto" }));
  assert.ok("error" in ev("autonomy.act", { area: "business-send", action: "pay", ref: "x" }));
  for (const a of AREAS) assert.ok(AREA_INFO[a].levels.includes(AREA_INFO[a].def), a);
});
