import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildPlan, type PlanItem } from "../src/lib/dayplan-pure.ts";
import { adjustPlan, nextAction, whyKey } from "../src/lib/life-plan-pure.ts";
import { MISSED_AFTER_MS, claim, nextSlot, reviewState, wallTime, wallToUtc, zoned } from "../src/lib/reminders-pure.ts";
import { pickTimer, restoreFocusTimer, workedMinutes } from "../src/lib/focus-timer-pure.ts";
import { JOURNAL_PRIVATE, runLifeTool } from "../src/lib/core-life.ts";
import { summaryText, view, emptyStore } from "../src/lib/life-pure.ts";
import type { Reminder } from "../src/lib/life-pure.ts";

const task = (id: string, min: number, extra: Partial<PlanItem> = {}): PlanItem => ({ id, title: id, min, flexible: true, source: { kind: "goal", label: "g" }, ...extra });
const fixed = (id: string, start: number, end: number): PlanItem => ({ id, title: id, min: end - start, flexible: false, fixed: { start, end }, source: { kind: "calendar", label: "cal" } });

test("LIF01: never plans more than the cap or the free time; explains the rest; buffer between tasks", () => {
  const items = [fixed("class", 9 * 60, 12 * 60), ...Array.from({ length: 12 }, (_, i) => task(`t${i}`, 60, { rank: i }))];
  const p = buildPlan(items, { day: "2026-10-30", now: 8 * 60, personal: null, maxPlanned: 240, dayEnd: 18 * 60 });
  const work = p.blocks.filter((b) => b.flexible);
  assert.ok(p.load!.plannedMin <= 240 && p.load!.plannedMin <= p.load!.freeMin);
  assert.equal(work.reduce((n, b) => n + b.end - b.start, 0), p.load!.plannedMin);
  for (let i = 1; i < work.length; i++) assert.ok(work[i].start >= work[i - 1].end + 10 || p.blocks.some((b) => !b.flexible && b.start >= work[i - 1].end && b.end <= work[i].start));
  assert.ok(work.every((b) => b.end <= 9 * 60 || b.start >= 12 * 60), "nothing on top of the fixed class");
  assert.ok(p.unplaced.length >= 8 && p.unplaced.every((u) => whyKey(u) === "life.why.cap"));
  assert.equal(whyKey({ id: "x", title: "x", source: { kind: "goal", label: "" } }), "life.why.manual");
});

test("LIF01: one next action: the running block, else the next one; none when the day is done", () => {
  const p = buildPlan([task("a", 30), task("b", 30)], { day: "2026-10-30", now: 8 * 60, personal: null });
  assert.equal(nextAction(p, 8 * 60 + 5)!.block.id, "a");
  assert.equal(nextAction(p, 8 * 60 + 5)!.now, true);
  assert.equal(nextAction(p, 8 * 60 + 35)!.block.id, "b");
  assert.equal(nextAction(p, 23 * 60), null);
  assert.equal(nextAction(null, 0), null);
});

test("LIF02: overrun shifts only later flexible blocks, minimally; locked events untouched; no-fit gets unscheduled", () => {
  const p = buildPlan([task("a", 60), fixed("meet", 10 * 60, 11 * 60), task("b", 30), task("c", 60)], { day: "2026-10-30", now: 8 * 60, personal: null, dayEnd: 12 * 60 + 30 });
  const before = Object.fromEntries(p.blocks.map((b) => [b.id, [b.start, b.end]]));
  const r = adjustPlan(p, "a", 15);
  assert.ok(typeof r !== "string");
  const after = Object.fromEntries(r.plan.blocks.map((b) => [b.id, [b.start, b.end]]));
  assert.deepEqual(after.meet, before.meet);
  assert.equal(after.a[1], before.a[1] + 15);
  for (const id of r.moved) assert.ok(after[id][0] >= after.a[1] + 10);
  for (const b of r.plan.blocks.filter((x) => x.flexible)) assert.ok(b.end <= 10 * 60 || b.start >= 11 * 60);
  for (const id of r.dropped) assert.ok(r.plan.unplaced.some((u) => u.id === id && u.why === "time"));
  assert.equal(adjustPlan(p, "meet", 15), "Fixed blocks don't move");
  assert.equal(adjustPlan(p, "a", 0), "Extra minutes must be 5–240");
  const tight = adjustPlan(p, "a", 240) as Exclude<ReturnType<typeof adjustPlan>, string>;
  assert.equal(tight.plan.blocks.find((b) => b.id === "a")!.end, 10 * 60, "a locked event wins over an overrun");
});

test("LIF03: wall time is Europe/Tallinn whatever the server TZ; DST and midnight keep 09:00 / 00:30", () => {
  assert.equal(wallTime(Date.parse("2026-10-30T07:00:00Z")), "09:00"); // EET +2 (after Oct 25)
  assert.equal(wallTime(Date.parse("2026-07-01T06:00:00Z")), "09:00"); // EEST +3
  // daily 09:00 across the 2026-10-25 fall-back: stays 09:00 local, UTC hour moves 06 → 07
  assert.equal(nextSlot("2026-10-24T06:00:00Z", "daily", Date.parse("2026-10-24T07:00:00Z"), "09:00"), "2026-10-25T07:00:00.000Z");
  // spring-forward 2026-03-29: 03:30 does not exist → 04:30 that night, then back to 03:30
  assert.equal(new Date(wallToUtc(2026, 3, 29, 3, 30)).toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(wallTime(Date.parse(nextSlot("2026-03-29T01:30:00Z", "daily", Date.parse("2026-03-29T02:00:00Z"), "03:30"))), "03:30");
  // 00:30 daily crosses midnight to the next calendar day; weekdays skip the weekend (2026-10-30 is a Friday)
  assert.equal(nextSlot("2026-10-29T22:30:00Z", "daily", Date.parse("2026-10-29T23:00:00Z"), "00:30"), "2026-10-30T22:30:00.000Z");
  assert.equal(zoned(Date.parse(nextSlot("2026-10-30T07:00:00Z", "weekdays", Date.parse("2026-10-30T08:00:00Z"), "09:00"))).wd, 1);
  const prev = process.env.TZ; process.env.TZ = "America/New_York"; // a restart on a machine in another zone changes nothing
  try { assert.equal(nextSlot("2026-10-24T06:00:00Z", "daily", Date.parse("2026-10-24T07:00:00Z"), "09:00"), "2026-10-25T07:00:00.000Z"); } finally { process.env.TZ = prev; }
});

test("LIF03: one notice per occurrence; missed-while-offline vs on time; acknowledgment clears it", () => {
  const at = Date.parse("2026-10-30T07:00:00Z");
  const one: Reminder = { id: "1", text: "call", at: new Date(at).toISOString() };
  assert.equal(claim({ ...one }, at - 1), null, "not due yet");
  const r = { ...one };
  assert.deepEqual(claim(r, at + 60_000), { id: "1", text: "call", at: one.at, missed: false });
  assert.equal(claim(r, at + 120_000), null, "second window / restart: no duplicate");
  const rep: Reminder = { id: "2", text: "pills", at: one.at, repeat: "daily", time: "09:00" };
  const n = claim(rep, at + 3 * 86_400_000 + MISSED_AFTER_MS + 1)!; // PC off for 3 days
  assert.equal(n.missed, true);
  assert.equal(rep.at, "2026-11-03T07:00:00.000Z", "jumps to the next future slot, no burst");
  assert.equal(claim(rep, at + 3 * 86_400_000 + MISSED_AFTER_MS + 2), null);
  const overdue: Reminder = { id: "3", text: "x", at: new Date(at - 5000).toISOString() };
  const s = reviewState([r, rep, overdue], at);
  assert.deepEqual(s.unacked.map((x) => [x.id, x.missed]), [["1", false], ["2", true]]);
  assert.deepEqual(s.overdue.map((x) => x.id), ["3"]);
  rep.ack = "now";
  assert.deepEqual(reviewState([rep], at).unacked, []);
});

test("LIF05: the timer keeps its task, newest device copy wins, Stop logs real minutes", () => {
  const r = restoreFocusTimer(JSON.stringify({ plan: 25, phase: "focus", endAt: 2_000_000, left: 1500, task: " essay ", at: 5 }), 1_000_000).timer;
  assert.equal(r.task, "essay");
  const remote = { ...r, at: 9 }, local = { ...r, at: 7 };
  assert.equal(pickTimer(local, remote), remote);
  assert.equal(pickTimer(remote, local), remote);
  assert.equal(pickTimer(local, null), local);
  assert.equal(workedMinutes({ plan: 25, phase: "focus", endAt: 1_000_000 + 15 * 60_000, left: 0 }, 1_000_000), 10);
  assert.equal(workedMinutes({ plan: 25, phase: "focus", endAt: 0, left: 25 * 60 - 61 }, 0), 1);
  assert.equal(workedMinutes({ plan: 25, phase: "break", endAt: 0, left: 10 }, 0), 0);
});

// ── LIF07 guard: journal text never reaches a model ────────────────────────────────────────────────────────────────
const SECRET = "journal-secret-7f3a";

test("LIF07: CORE's journal tool and LIFE summary never carry journal text", async () => {
  assert.equal(await runLifeTool("life_journal", { days: 31 }, "reflect on my journal", false), JOURNAL_PRIVATE);
  const s = emptyStore(); s.journal["2026-10-30"] = SECRET;
  const st = view(s, Date.parse("2026-10-30T12:00:00"));
  assert.ok(!summaryText(st, Date.now()).includes(SECRET));
});

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const src = path.join(import.meta.dirname, "../src");
const MODEL = /\b(askClaude|callModel|runCore|anthropic|messages\.create|VOICE_ASK|generateText|streamText)\b/;
// Files allowed to read the LIFE journal: the store itself, the LIFE UI, local backup/export and the local search route — none calls a model.
const ALLOWED = ["lib/life.ts", "lib/life-pure.ts", "components/LifePanel.tsx", "lib/backup.ts", "lib/demo-pure.ts", "app/api/search/route.ts", "app/api/life/route.ts"];

test("LIF07: no model-call path can read LIFE journal content", () => {
  const offenders: string[] = [];
  for (const f of walk(src)) {
    const rel = path.relative(src, f).split(path.sep).join("/"), code = readFileSync(f, "utf8");
    const readsLife = /\b(exportLife|getLife|journalDigest|journalText)\b|from ["'][^"']*\/life(-pure)?(\.ts)?["']/.test(code);
    const readsJournal = readsLife && /\.journal\b|journal\s*[:\]]/.test(code);
    if (!readsJournal) continue;
    if (!ALLOWED.includes(rel)) offenders.push(`${rel}: reads the LIFE journal`);
    else if (MODEL.test(code)) offenders.push(`${rel}: reads the LIFE journal and has a model call`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(!/journalDigest|journalText/.test(readFileSync(path.join(src, "lib/core-life.ts"), "utf8")));
});
