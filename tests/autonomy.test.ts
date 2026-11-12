import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREAS, AREA_INFO, AUTO_CONFIRM, DEFAULT_LEVELS, LIMIT_DEFAULTS, autonomyAllows, autonomyDefaults, autoPush, commitmentIn, doneToday, nightOff,
  parseAutonomy, patchLimits, pickAuto, setLevel, autoClock, quietAuto, UNDO_MS, cancelPending, clipVersion, sendOutcome, autoApprove, autoLedger, draftCandidate, undoAutoApprove, type Pending, type Area, type AutonomyState,
} from "../src/lib/autonomy-pure.ts";
import { decide, TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { planNight, NIGHT_DEFAULTS, type PlanInput } from "../src/lib/night-pure.ts";
import { validate } from "../src/lib/ledger-pure.ts";

// What ORBIT did on its own before Autonomy existed: these ran unattended (night shift, scout, sleep loop, deal hunt, calls).
const RAN_ALONE_TODAY: Area[] = ["research", "brief", "briefings", "memory", "studio-prepare", "business-drafts", "goals", "night-shift", "deals", "calls", "operator-build", "operator-organize"]; // operator: standing grants, AGENTS.md rule 6

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
  const i: PlanInput = { tonight: [{ id: "t1", text: "x", agent: "atlas", by: "owner", at: "" }], goals: [], followups: [{ id: "p1", name: "Cafe" }], drafted: {}, nicheDue: true, deals: 2, health: true, handled: [], now: Date.parse("2026-07-02T22:30:00Z"), today: "2026-07-03" };
  assert.deepEqual(planNight({ ...i, off: nightOff(DEFAULT_LEVELS) }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }), planNight(i, NIGHT_DEFAULTS, { calls: 0, ms: 0 }));
  const off = nightOff({ ...DEFAULT_LEVELS, research: "ask", "business-drafts": "off" });
  assert.deepEqual(off.sort(), ["business", "niche", "research", "rivals"]);
  assert.deepEqual(planNight({ ...i, off }, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.map((t) => t.kind), ["hygiene", "health", "deals", "clips"]);
  assert.ok(planNight(i, NIGHT_DEFAULTS, { calls: 0, ms: 0 }).queue.some((t) => t.kind === "health")); // the pin above includes the new health slot
  assert.deepEqual(nightOff({ ...DEFAULT_LEVELS, "night-shift": "off" }), ["health", "personas", "backup", "loops"]); // health, the persona playtest and the time capsule belong to the night shift itself
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
  assert.match(setLevel(s, "business-send", "auto", AUTO_CONFIRM["business-send"], 0, "REMOTE_VAPID_PUBLIC is missing") as string, /needs phone pushes.*VAPID/); // no push set up: no auto
  assert.equal(typeof setLevel(s, "business-send", "ask", "", 0, "REMOTE_VAPID_PUBLIC is missing"), "object"); // other levels still work
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
  for (const t of ["It costs €200", "Only 99 EUR a month", "our price is low", "send the invoice", "sign the contract", "I will deliver by Friday", "we'll do it", "20% off", "$50",
    "a free trial", "a short pilot", "a small discount", "my IBAN", "bank transfer", "you pay later", "two hundred euros", "kakssada eurot", "viis eurot", "tasuta proov",
    "hinnaga", "leping", "Это бесплатно", "цена", "договор", "we'd love to", "I guarantee it", "I promise", "ready by tomorrow", "on Monday", "in March 3", "call me at 5",
    "A quick idea for Cafe 21"]) // the last one: the email subject is filtered too (any digit)
    assert.notEqual(commitmentIn(t), "", t);
  for (const t of ["Hi, I liked your menu. Want to see a short idea?", "Design ideas for your shop", "Appreciate your time", "Tere! Mul on üks idee teie kohviku jaoks.", "Привет, есть идея",
    "A quick idea for Cafe Roma"]) assert.equal(commitmentIn(t), "", t);
  assert.match(autonomyAllows("business-send", "auto", { ...base, text: "It's only €50" }).why, /always need you/);
});

test("pickAuto: once per target, cap counts pending and today's, nothing unless auto", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const c = (ref: string, text = "Hi, a short idea for you") => ({ ref, seen: "v", label: ref, text, changedAt: "2026-10-25T11:00:00Z" });
  const s: AutonomyState = { ...autonomyDefaults(), levels: { ...DEFAULT_LEVELS, "business-send": "auto" }, limits: { sendPerDay: 2, publishPerDay: 1 }, since: { "business-send": "2026-10-25T10:00:00Z" } };
  assert.deepEqual(pickAuto(autonomyDefaults(), "business-send", [c("a")], now, false), []);
  assert.deepEqual(pickAuto(s, "business-send", [c("a"), c("b", "pay 5 now"), c("c"), c("d")], now, false).map((x) => x.ref), ["a", "c"]);
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

test("quiet hours 23:00-08:00 Tallinn: auto actions are held, and the 10-minute cancel window starts at 08:00", () => {
  const at = (iso: string) => Date.parse(iso); // October: Tallinn is UTC+3 until the 25th, UTC+2 after
  const p = (id: string, dueAt: string, area: Pending["area"] = "business-send"): Pending => ({ id, area, ref: id, seen: "v", label: id, at: "", dueAt });
  assert.equal(quietAuto(at("2026-10-20T20:30:00Z")), true); // 23:30
  assert.equal(quietAuto(at("2026-10-20T04:59:00Z")), true); // 07:59
  assert.equal(quietAuto(at("2026-10-20T05:00:00Z")), false); // 08:00
  assert.equal(quietAuto(at("2026-10-20T19:59:00Z")), false); // 22:59
  // queued 22:55, due 23:05: at 23:05 it is held, not sent
  const night = autoClock([p("a", "2026-10-20T20:05:00Z"), p("b", "")], at("2026-10-20T20:05:00Z"));
  assert.deepEqual(night.due, []);
  assert.deepEqual(night.opened, {});
  assert.ok(night.pending.every((x) => x.dueAt === ""));
  assert.deepEqual(autoClock(night.pending, at("2026-10-21T01:00:00Z")).due, []); // 04:00: still nothing
  // 08:00: a fresh window opens (and is pushed about), nothing goes out yet
  const t8 = at("2026-10-21T05:00:00Z"), morning = autoClock([...night.pending, p("c", "", "studio-publish")], t8);
  assert.deepEqual(morning.due, []);
  assert.deepEqual(morning.opened, { "business-send": 2, "studio-publish": 1 });
  assert.ok(morning.pending.every((x) => Date.parse(x.dueAt) === t8 + UNDO_MS));
  // 08:10: due; a cancelled one (removed from pending) simply isn't there
  const later = autoClock(morning.pending.filter((x) => x.id !== "b"), t8 + UNDO_MS);
  assert.deepEqual(later.due.map((x) => x.id), ["a", "c"]);
  assert.deepEqual(later.opened, {});
});

test("Cancel and Stop-all stick: a cancelled version is never re-queued (also after Resume); a new version may be", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const c = (ref: string, seen = "v1") => ({ ref, seen, label: ref, text: "Hi, a short idea for you", changedAt: "2026-10-25T11:00:00Z" });
  const on = setLevel(autonomyDefaults(), "business-send", "auto", AUTO_CONFIRM["business-send"], Date.parse("2026-10-25T10:00:00Z")) as AutonomyState;
  const q = (s: AutonomyState, refs: string[]): AutonomyState => ({ ...s, pending: [...s.pending, ...refs.map((r) => ({ id: r, area: "business-send" as const, ref: r, seen: "v1", label: r, at: "", dueAt: "" }))] });
  const queued = q(on, ["a", "b"]);
  const afterCancel = cancelPending(queued, (p) => p.id !== "a"); // his Cancel on "a"
  assert.deepEqual(afterCancel.pending.map((p) => p.ref), ["b"]);
  assert.deepEqual(afterCancel.cancelled, [{ area: "business-send", ref: "a", seen: "v1" }]);
  assert.deepEqual(pickAuto(afterCancel, "business-send", [c("a")], now, false), []);
  assert.deepEqual(pickAuto(afterCancel, "business-send", [c("a", "v2")], now, false).map((x) => x.ref), ["a"]); // he edited the draft: a new version
  const stopped = cancelPending(queued, () => false); // Stop-all
  assert.deepEqual(stopped.pending, []);
  assert.deepEqual(pickAuto(stopped, "business-send", [c("a"), c("b")], now, false), []); // Resume: nothing comes back
  // leaving auto cancels too, and switching back on starts a new `since`
  const left = setLevel(queued, "business-send", "ask", "") as AutonomyState;
  assert.equal(left.cancelled.length, 2);
  const again = setLevel(left, "business-send", "auto", AUTO_CONFIRM["business-send"], Date.parse("2026-10-25T11:30:00Z")) as AutonomyState;
  assert.equal(again.since["business-send"], "2026-10-25T11:30:00.000Z");
  assert.equal((setLevel(again, "business-send", "auto", AUTO_CONFIRM["business-send"], now) as AutonomyState).since["business-send"], "2026-10-25T11:30:00.000Z"); // unchanged while on
  assert.deepEqual(parseAutonomy(JSON.stringify(stopped)).cancelled, stopped.cancelled); // survives a restart
});

test("no back-catalogue blast: only drafts/clips made after auto was switched on; no `since` = nothing", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const c = (ref: string, changedAt: string) => ({ ref, seen: "v", label: ref, text: "Hi, a short idea for you", changedAt });
  const on = setLevel(autonomyDefaults(), "business-send", "auto", AUTO_CONFIRM["business-send"], Date.parse("2026-10-25T10:00:00Z")) as AutonomyState;
  assert.deepEqual(pickAuto(on, "business-send", [c("old", "2026-10-20T10:00:00Z"), c("new", "2026-10-25T10:30:00Z"), c("bad", "")], now, false).map((x) => x.ref), ["new"]);
  assert.deepEqual(pickAuto({ ...on, since: {} }, "business-send", [c("new", "2026-10-25T10:30:00Z")], now, false), []); // hand-edited auto, no switch time
});

test("fired outcomes: unknown-result sends and failed auto-publishes count toward the cap; ORBIT's approve leaves no owner review entry", () => {
  assert.equal(sendOutcome(true, 200), "done");
  assert.equal(sendOutcome(false, 502), "unsure");
  assert.equal(sendOutcome(false, 504), "unsure");
  assert.equal(sendOutcome(false, 409), "skip");
  assert.equal(sendOutcome(false, 503), "skip");
  assert.equal(autoPush("business-send", "unsure").title, "ORBIT's auto email: result unknown");
  const job = { updatedAt: "", feedback: [] as unknown[] }, clip: { status: string; publish?: unknown } = { status: "ready" };
  autoApprove(job, clip, Date.parse("2026-10-25T12:00:00Z"));
  assert.equal(clip.status, "approved");
  assert.deepEqual(job.feedback, []);
  assert.equal(undoAutoApprove(clip), true); // scheduleAll refused: back to Waiting for you
  assert.equal(clip.status, "ready");
  const going = { status: "approved", publish: { status: "uploading" } };
  assert.equal(undoAutoApprove(going), false); // already on its way: left alone
  assert.equal(going.status, "approved");
});

test("a Short's version covers video, title and description: editing any one makes a cancelled clip a new version", () => {
  const base = { video: "clips/a.mp4", title: "Fox in snow", hook: "Watch this" };
  const v = clipVersion(base);
  for (const change of [{ video: "clips/b.mp4" }, { title: "Fox in the snow" }, { hook: "Wait for it" }]) assert.notEqual(clipVersion({ ...base, ...change }), v);
  assert.equal(clipVersion({ ...base }), v);
  const s: AutonomyState = { ...autonomyDefaults(), levels: { ...DEFAULT_LEVELS, "studio-publish": "auto" }, since: { "studio-publish": "2026-10-25T10:00:00Z" },
    cancelled: [{ area: "studio-publish", ref: "j/c", seen: v }] };
  const cand = (seen: string) => ({ ref: "j/c", seen, label: "Short", text: "Fox in snow\nWatch this", changedAt: "2026-10-25T11:00:00Z" });
  assert.deepEqual(pickAuto(s, "studio-publish", [cand(v)], Date.parse("2026-10-25T12:00:00Z"), false), []);
  assert.equal(pickAuto(s, "studio-publish", [cand(clipVersion({ ...base, title: "New title" }))], Date.parse("2026-10-25T12:00:00Z"), false).length, 1);
  assert.equal(parseAutonomy(JSON.stringify({ ...s, pending: [{ id: "1", area: "studio-publish", ref: "j/c", seen: v + "x".repeat(400), label: "l", at: "", dueAt: "" }] })).pending.length, 1); // long versions survive a restart
});

test("AGENTS.md rule 6 as code: under-cap send passes, the 4th is held, spend is always held, Auto off holds everything", () => {
  const ok = { limits: LIMIT_DEFAULTS, known: true, text: "Hi, a short idea for you" };
  const auto = { ...DEFAULT_LEVELS, "business-send": "auto" as const, "studio-publish": "auto" as const, "higgsfield-spend": "auto" as const }; // spend forced to auto anyway
  for (const n of [0, 1, 2]) assert.equal(autonomyAllows("business-send", "auto", { ...ok, levels: auto, doneToday: n }).ok, true, `send ${n + 1}`);
  assert.equal(autonomyAllows("business-send", "auto", { ...ok, levels: auto, doneToday: 3 }).ok, false); // the 4th
  assert.equal(autonomyAllows("studio-publish", "auto", { ...ok, levels: auto, doneToday: 1 }).ok, false); // the 2nd publish
  assert.equal(autonomyAllows("higgsfield-spend", "auto", { ...ok, levels: auto, doneToday: 0 }).ok, false);
  assert.equal(typeof setLevel(autonomyDefaults(), "higgsfield-spend", "auto", "x"), "string");
  for (const a of AREAS) assert.equal(autonomyAllows(a, "auto", { ...ok, levels: DEFAULT_LEVELS, doneToday: 0 }).ok, false, a);
  const on: AutonomyState = { ...autonomyDefaults(), levels: auto, pending: [{ id: "1", area: "business-send", ref: "p", seen: "v", label: "", at: "", dueAt: "" }] };
  const off = setLevel(on, "business-send", "ask", "") as AutonomyState;
  assert.deepEqual(off.pending, []); // turning Auto off drops what was queued, right away
  assert.deepEqual(AREAS.filter(a => AREA_INFO[a].levels.includes("auto")).sort(), ["business-send", "studio-publish"]); // rule 6 scope: a new Auto area fails here
});

test("an old draft stays old after an unrelated edit to the prospect: the draft's own drafted_at counts, not updated_at", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const on = setLevel(autonomyDefaults(), "business-send", "auto", AUTO_CONFIRM["business-send"], Date.parse("2026-10-25T10:00:00Z")) as AutonomyState;
  const row = (drafted_at: string | null) => ({ id: "p1", name: "Cafe", draft: "Hi, a short idea for you", updated_at: "2026-10-25T11:00:00Z", drafted_at });
  assert.deepEqual(pickAuto(on, "business-send", [draftCandidate(row("2026-10-20T10:00:00Z"), "Idea")], now, false), []); // note edited today, draft from last week
  assert.deepEqual(pickAuto(on, "business-send", [draftCandidate(row(null), "Idea")], now, false), []); // drafted before 0026
  const fresh = draftCandidate(row("2026-10-25T10:30:00Z"), "Idea");
  assert.equal(fresh.seen, "2026-10-25T11:00:00Z"); // the version sendDraft claims
  assert.deepEqual(pickAuto(on, "business-send", [fresh], now, false).map((x) => x.ref), ["p1"]);
});

test("month names and relative years are held like dates", () => {
  for (const t of ["See you in March", "May works for us", "Let's talk next year", "this week?"]) assert.ok(commitmentIn(t), t);
  assert.equal(commitmentIn("Hi, a short idea for your cafe"), "");
});

test("the ledger gets every fired auto action, also an unknown-result publish", () => {
  assert.deepEqual(autoLedger("studio-publish", "j/c", "unsure"), { area: "studio-publish", action: "publish", ref: "j/c", result: "unsure" });
  assert.equal(autoLedger("business-send", "x".repeat(200), "done").ref.length, 128);
});

test("Briefings & digests: default On, old saves without the key stay On, Off/Ask/Stop-all skip all four background calls", async () => {
  assert.equal(parseAutonomy(JSON.stringify({ levels: { research: "off" } })).levels.briefings, "do");
  assert.equal(autonomyAllows("briefings", "background").ok, true);
  for (const levels of [{ briefings: "off" as const }, { briefings: "ask" as const }]) assert.equal(autonomyAllows("briefings", "background", { levels }).ok, false);
  assert.equal(autonomyAllows("briefings", "background", { stopAll: true }).ok, false);
  assert.equal(autonomyAllows("briefings", "owner", { levels: { briefings: "ask" } }).ok, true); // his Refresh / opening the brief
  // The gates sit on the four call sites (IO modules can't load here, so check the source).
  const { readFileSync } = await import("node:fs");
  const sch = readFileSync(new URL("../src/lib/scheduler.ts", import.meta.url), "utf8"), arch = readFileSync(new URL("../src/lib/arch-digest.ts", import.meta.url), "utf8");
  assert.match(sch, /for \(const kind of brief\.ok \? due : \[\]\)/);
  assert.match(sch, /if \(brief\.ok && !usageHold\(\) && await proposalsDue/);
  assert.match(sch, /allows\("briefings", "background"\)\.ok\) void maybeScorecard/);
  assert.match(arch, /allows\("briefings", "background"\)\.ok\) \{[^\n]*\n\s*const r = await askClaude/);
});
