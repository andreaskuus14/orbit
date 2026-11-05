import { test } from "node:test";
import assert from "node:assert/strict";
import { briefState, clipsState, leadsState, dailyText, digestMsg, digestDue, slotAt } from "../src/lib/daily-pure.ts";

const at = (hhmm: string) => slotAt(new Date(2026, 10, 5, 12).getTime(), hhmm);
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();

test("brief: planned before the slot, missed after the grace with no record", () => {
  assert.equal(briefState({ briefings: [], runs: [] }, at("07:00")).state, "planned");
  assert.equal(briefState({ briefings: [], runs: [] }, at("08:00")).state, "planned"); // within 45 min
  const m = briefState({ briefings: [], runs: [] }, at("09:00"));
  assert.equal(m.state, "missed");
  assert.ok(m.next);
});

test("brief: stored row = completed; verified only with articles", () => {
  assert.deepEqual([briefState({ briefings: [{ kind: "morning", created_at: iso("07:32"), article_count: 12 }], runs: [] }, at("09:00"))].map((x) => [x.state, x.verified]), [["completed", true]]);
  assert.equal(briefState({ briefings: [{ kind: "morning", created_at: iso("07:32"), article_count: 0 }], runs: [] }, at("09:00")).verified, false);
  assert.equal(briefState({ briefings: [{ kind: "midday", created_at: iso("12:31"), article_count: 5 }], runs: [] }, at("13:00")).state, "missed"); // another kind doesn't count
});

test("brief: failed run, live run, dead run", () => {
  assert.equal(briefState({ briefings: [], runs: [{ status: "failed", detail: "morning: all feeds failed", started_at: iso("07:30") }] }, at("09:00")).state, "failed");
  assert.equal(briefState({ briefings: [], runs: [{ status: "running", detail: "morning: all", started_at: iso("07:30") }] }, at("07:40")).state, "attempted");
  assert.equal(briefState({ briefings: [], runs: [{ status: "running", detail: "morning: all", started_at: iso("07:30") }] }, at("09:00")).state, "uncertain");
});

const job = (status: string, updated: string, clips: { status: string; publish?: { status: string; at: string; destination?: string } }[] = []) => ({ status, updatedAt: iso(updated), clips });

test("clips: idle, review waits for him, unsure upload wins, verified only when every upload read back", () => {
  const now = at("12:00");
  assert.equal(clipsState([], now).state, "idle");
  assert.equal(clipsState([job("done", "09:00", [{ status: "ready" }])], now).state, "waiting");
  assert.equal(clipsState([job("done", "09:00", [{ status: "approved", publish: { status: "unknown", at: iso("10:00") } }, { status: "ready" }])], now).state, "uncertain");
  const ok = clipsState([job("done", "09:00", [{ status: "approved", publish: { status: "done", at: iso("10:00"), destination: "ok" } }])], now);
  assert.deepEqual([ok.state, ok.verified], ["completed", true]);
  assert.equal(clipsState([job("done", "09:00", [{ status: "approved", publish: { status: "done", at: iso("10:00"), destination: "title differs" } }])], now).verified, false);
  assert.equal(clipsState([job("rendering", "11:50")], now).state, "attempted");
  assert.equal(clipsState([job("failed", "09:00")], now).state, "failed");
});

test("leads: off, planned, missed, waiting, completed by receipt", () => {
  const now = at("12:00"), auto = { enabled: true, time: "09:15" };
  assert.equal(leadsState({ automation: null, tasks: [] }, now).state, "off");
  assert.equal(leadsState({ automation: { ...auto, enabled: false }, tasks: [] }, now).state, "off");
  assert.equal(leadsState({ automation: { ...auto, time: "13:00" }, tasks: [] }, now).state, "planned");
  assert.equal(leadsState({ automation: auto, tasks: [] }, now).state, "missed");
  assert.equal(leadsState({ automation: auto, tasks: [{ status: "awaiting_approval", created_at: iso("09:15"), pending: [], receipt: null }] }, now).state, "waiting");
  const done = leadsState({ automation: auto, tasks: [{ status: "done", created_at: iso("09:15"), pending: null, receipt: "verified" }] }, now);
  assert.deepEqual([done.state, done.verified], ["completed", true]);
  assert.equal(leadsState({ automation: auto, tasks: [{ status: "done", created_at: iso("09:15"), pending: null, receipt: "unverified" }] }, now).verified, false);
});

test("digest: labels only, flags failures; tool text never upgrades a state", () => {
  const v = { day: "2026-11-05", items: [briefState({ briefings: [], runs: [] }, at("12:00")), clipsState([], at("12:00")), leadsState({ automation: null, tasks: [] }, at("12:00"))] };
  const m = digestMsg(v);
  assert.equal(m.kind, "failed");
  assert.match(m.message, /^Brief: MISSED · Clips: nothing new · Leads: off$/);
  assert.match(dailyText(v), /Brief: missed — no run recorded/);
  assert.doesNotMatch(dailyText(v), /, verified/);
});

test("digest due: once a day, from its time, off disables", () => {
  assert.equal(digestDue(undefined, null, "2026-11-05", at("10:00")), false);
  assert.equal(digestDue(undefined, null, "2026-11-05", at("10:31")), true);
  assert.equal(digestDue(undefined, "2026-11-05", "2026-11-05", at("11:00")), false);
  assert.equal(digestDue("off", null, "2026-11-05", at("23:00")), false);
  assert.equal(digestDue("8:00", null, "2026-11-05", at("08:01")), true);
  assert.equal(digestDue("25:00", null, "2026-11-05", at("23:00")), false);
});
