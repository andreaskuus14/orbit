import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WORDS, briefDecisions, briefItems, briefOpener, cleanPolish, composeBrief, shouldShowBrief, type BriefIn } from "../src/lib/brief-pure.ts";
import { cleanOpener } from "../src/lib/call-pure.ts";
import type { NightReport } from "../src/lib/night-pure.ts";

const at = "2026-10-25T03:00:00Z";
const night = {
  key: "2026-10-25", startedAt: at, running: false, calls: 12, minutes: 40, deferred: 0,
  done: [{ kind: "research", ref: "r1", label: "Researched Roblox pet sim retention", status: "done", at, open: { task: "t9" } }],
  approvals: [{ kind: "business", ref: "p1", label: "Follow-up draft for Kalev Bakery", status: "approval", at, open: { task: "t1" }, draft: "PRIVATE DRAFT TEXT" }],
  failed: [],
} as unknown as NightReport;
const base = (over: Partial<BriefIn> = {}): BriefIn => ({
  day: "2026-10-25", hour: 8, life: false,
  morning: {
    night,
    calendar: { connected: true, today: [{ time: "10:00", title: "Dentist appointment" }, { time: "15:00", title: "Call with Mari" }] },
    life: { habits: 2, done: 0, next: { text: "take vitamins", at: "09:00" } },
    hero: { kind: "task", key: "studio:ready", title: "Review 3 new clips", why: "They are ready to schedule for today", base: 0.9, score: 0.9, open: { panel: "studio", view: "review" } },
    studio: { ready: 3, approved: 0, today: [], scout: "", pausedUntil: "", yesterday: [{ title: "Pet sim secret egg", views: 12400, videoId: "abcdefghijk" }, { title: "Slow one", views: 80 }] },
  },
  decisions: briefDecisions(night.approvals, [], [{ id: "send:p2", kind: "send", title: "Tartu Cafe", to: "hi@tartu.ee" }]),
  replies: [{ id: "p3", name: "Kalev Bakery" }], lesson: { id: "l1", text: "You usually open STUDIO cards first." }, snoozed: [],
  ...over,
});

test("items come in priority order, each with a source id, at most 6", () => {
  const items = briefItems(base());
  assert.deepEqual(items.map((i) => i.kind), ["decision", "decision", "night", "calendar", "first", "result", "result", "lesson"]);
  const b = composeBrief(base());
  assert.ok(b.items.length <= 6 && b.items.length >= 4);
  assert.ok(b.items.every((i) => i.id && i.say && i.title));
  assert.equal(b.items[0].id, "decision:task:t1");
  assert.deepEqual(b.items[0].approve, { task: "t1" });
  assert.equal(b.items[1].approve, undefined, "an email is never one-tap approved");
});

test("spoken: warm sentences, no lists, under the word cap, no private text", () => {
  const b = composeBrief(base());
  assert.ok(b.spoken.startsWith("Good morning, Andreas."));
  assert.ok(b.spoken.split(/\s+/).length <= MAX_WORDS);
  assert.doesNotMatch(b.spoken, /As an AI|^\s*[-•]|\n/m);
  assert.doesNotMatch(b.spoken, /PRIVATE DRAFT|Dentist|vitamins/, "LIFE text and drafts stay out by default");
  assert.match(b.spoken, /two things need your OK/i);
  assert.match(b.spoken, /two things on the calendar today, the first at 10:00\./);
});

test("LIFE opt-in says the calendar title; no calendar falls back to a reminder only with opt-in", () => {
  assert.match(composeBrief(base({ life: true })).spoken, /Dentist appointment/);
  const m = { ...base().morning, calendar: undefined };
  assert.equal(briefItems(base({ morning: m })).some((i) => i.kind === "calendar"), false);
  assert.match(briefItems(base({ morning: m, life: true })).find((i) => i.kind === "calendar")!.say, /09:00: take vitamins/);
});

test("snoozed items drop; a slow Short is not a result; empty input is a calm brief", () => {
  assert.ok(!briefItems(base({ snoozed: ["decision:task:t1"] })).some((i) => i.id === "decision:task:t1"));
  const results = briefItems(base()).filter((i) => i.kind === "result");
  assert.equal(results[0].id, "short:abcdefghijk");
  const empty = composeBrief({ day: "2026-10-25", hour: 7, life: false, morning: {}, decisions: [], replies: [], snoozed: [] });
  assert.equal(empty.items.length, 0);
  assert.match(empty.spoken, /Nothing needs you this morning/);
});

test("work approvals dedupe against the night shift; the hero is not said twice", () => {
  const d = briefDecisions(night.approvals, [{ kind: "task", id: "t1", title: "x", status: "awaiting_approval", detail: "", action: "Approve" }, { kind: "goal", id: "g1", title: "Launch", status: "awaiting_approval", detail: "", action: "Approve" }], []);
  assert.deepEqual(d.map((x) => x.id), ["task:t1", "goal:g1"]);
  assert.equal(d[1].approve, undefined);
  const hero = { kind: "task" as const, key: "work:t1", title: "Approve x", why: "Waiting", base: 1, score: 1, open: { work: { kind: "task" as const, id: "t1", title: "x", status: "awaiting_approval", detail: "", action: "Approve" } } };
  assert.ok(!briefItems(base({ morning: { ...base().morning, hero } })).some((i) => i.kind === "first"));
});

test("phone opener: same composer, short, ends on exactly one question, passes the call's cleaner", () => {
  const o = briefOpener(composeBrief(base()), 8);
  assert.ok(o.startsWith("Morning."));
  assert.equal((o.match(/\?/g) ?? []).length, 1);
  assert.ok(o.endsWith("?"));
  assert.equal(cleanOpener(o, "fallback"), o);
});

test("polish keeps facts or falls back", () => {
  const b = composeBrief(base()).spoken;
  assert.equal(cleanPolish("As an AI, " + b, b), b);
  assert.equal(cleanPolish(b.replace("10:00", "11:00"), b), b, "a changed number is rejected");
  assert.equal(cleanPolish("- " + b, b), b, "no list markers");
  assert.equal(cleanPolish("Morning.", b), b, "too short");
  const warm = b.replace("Good morning, Andreas.", "Morning, Andreas, hope you slept well.");
  assert.equal(cleanPolish(`"${warm}"`, b), warm);
});

test("shows once a day from 06:00", () => {
  assert.equal(shouldShowBrief(null, 5, "2026-10-25"), false);
  assert.equal(shouldShowBrief(null, 6, "2026-10-25"), true);
  assert.equal(shouldShowBrief("2026-10-25", 9, "2026-10-25"), false);
  assert.equal(shouldShowBrief("2026-10-24", 9, "2026-10-25"), true);
});

test("a great deal is a notable result with Open to MARKETS → Deals", () => {
  const it = briefItems(base({ decisions: [], replies: [], morning: {}, deal: { id: "o1", item: "Sony WH-1000XM5", eur: 189.6 } })).find((i) => i.id === "deal:o1")!;
  assert.equal(it.kind, "result");
  assert.equal(it.say, "An offer for Sony WH-1000XM5 came in at about 190 euros. That looks like a good price.");
  assert.deepEqual(it.open, { panel: "markets", tab: "Deals" });
});

test("a new serious health problem gets one line after the night shift, opening the Doctor panel", () => {
  const items = briefItems(base({ health: { id: "h1234abcd", title: "Crash", say: "One health note: ORBIT ran out of memory. The details are in the Doctor panel, ready to hand to a builder." } }));
  assert.deepEqual(items.slice(0, 4).map((i) => i.kind), ["decision", "decision", "night", "health"]);
  const h = items.find((i) => i.kind === "health")!;
  assert.equal(h.id, "health:h1234abcd");
  assert.deepEqual(h.open, { doctor: true });
  assert.equal(briefItems(base({ health: { id: "h1", title: "x", say: "y" }, snoozed: ["health:h1"] })).some((i) => i.kind === "health"), false);
});
