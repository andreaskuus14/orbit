import { test } from "node:test";
import assert from "node:assert/strict";
import { briefState, clipsState, leadsState, dailyText, digestMsg, digestDue, slotAt } from "../src/lib/daily-pure.ts";

const at = (hhmm: string) => slotAt(new Date(2026, 10, 5, 12).getTime(), hhmm);
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();

test("brief: planned before the slot, missed after the grace with no record", () => {
  assert.equal(briefState({ briefings: [], runs: [] }, at("07:00")).state, "planned");
  assert.equal(briefState({ briefings: [], runs: [] }, at("08:00")).state, "planned"); // within 45 min
  const c = briefState({ briefings: [], runs: [] }, at("09:00"));
  assert.equal(c.state, "planned"); // the scheduler still catches it up until 11:30
  assert.match(c.evidence, /catches it up by 11:30/);
  const m = briefState({ briefings: [], runs: [] }, at("11:45"));
  assert.equal(m.state, "missed");
  assert.match(m.next!, /usage limit/);
});

test("brief: stored row = completed; verified only with articles", () => {
  assert.deepEqual([briefState({ briefings: [{ kind: "morning", created_at: iso("07:32"), article_count: 12 }], runs: [] }, at("09:00"))].map((x) => [x.state, x.verified]), [["completed", true]]);
  assert.equal(briefState({ briefings: [{ kind: "morning", created_at: iso("07:32"), article_count: 0 }], runs: [] }, at("09:00")).verified, false);
  assert.equal(briefState({ briefings: [{ kind: "midday", created_at: iso("12:31"), article_count: 5 }], runs: [] }, at("13:00")).state, "missed"); // another kind doesn't count
  assert.equal(briefState({ briefings: [{ kind: "manual", created_at: iso("12:00"), article_count: 4 }], runs: [] }, at("13:00")).state, "completed", "a brief he asked for after 07:30 stands in");
  assert.equal(briefState({ briefings: [{ kind: "manual", created_at: iso("06:00"), article_count: 4 }], runs: [] }, at("13:00")).state, "missed", "one from before the slot doesn't");
  assert.equal(briefState({ briefings: [], runs: [{ status: "failed", detail: "manual: feeds down", started_at: iso("06:00") }] }, at("07:00")).state, "planned", "a failed manual brief before 07:30 isn't today's brief");
});

test("brief: failed run, live run, dead run", () => {
  assert.equal(briefState({ briefings: [], runs: [{ status: "failed", detail: "morning: all feeds failed", started_at: iso("07:30") }] }, at("09:00")).state, "failed");
  assert.equal(briefState({ briefings: [], runs: [{ status: "running", detail: "morning: all", started_at: iso("07:30") }] }, at("07:40")).state, "attempted");
  assert.equal(briefState({ briefings: [], runs: [{ status: "running", detail: "morning: all", started_at: iso("07:30") }] }, at("09:00")).state, "uncertain");
});

const job = (status: string, created: string, clips: { status: string; publish?: { status: string; at: string; destination?: string } }[] = []) => ({ status, createdAt: iso(created), updatedAt: iso(created), clips });

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
  // review findings: a failed or in-flight upload is never "done"; an edit to an old job doesn't make it today's work
  const f = clipsState([job("done", "09:00", [{ status: "approved", publish: { status: "failed", at: iso("10:00") } }])], now);
  assert.equal(f.state, "failed");
  assert.match(f.evidence, /1 upload failed/);
  assert.equal(clipsState([job("done", "09:00", [{ status: "approved", publish: { status: "uploading", at: iso("11:59") } }])], now).state, "attempted");
  const old = { ...job("done", "09:00", [{ status: "rejected" }]), createdAt: new Date(now - 3 * 86_400_000).toISOString(), updatedAt: iso("11:00") };
  assert.equal(clipsState([old], now).state, "idle");
});

const day = (hhmm: string, extra: Partial<{ next: number | null; grace: number; label: string }> = {}) => ({ enabled: true, slot: at(hhmm), next: null, grace: 3 * 3600_000, label: "Every day at " + hhmm, ...extra });

test("leads: off, planned, missed, waiting, completed by receipt; failed and partly receipts aren't plain done", () => {
  const now = at("12:30"), auto = day("09:15");
  const run = (status: string, receipt: string | null) => leadsState({ automation: auto, tasks: [{ status, created_at: iso("09:15"), pending: null, receipt }] }, now);
  assert.equal(leadsState({ automation: null, tasks: [] }, now).state, "off");
  assert.equal(leadsState({ automation: { ...auto, enabled: false }, tasks: [] }, now).state, "off");
  assert.equal(leadsState({ automation: { ...day("09:15"), slot: at("09:15") - 86_400_000, next: at("13:00") }, tasks: [] }, now).state, "planned");
  assert.equal(leadsState({ automation: auto, tasks: [] }, at("11:00")).state, "planned", "within the 3 h the automation still fires");
  assert.equal(leadsState({ automation: auto, tasks: [] }, now).state, "missed");
  assert.equal(leadsState({ automation: auto, tasks: [{ status: "awaiting_approval", created_at: iso("09:15"), pending: [], receipt: null }] }, now).state, "waiting");
  assert.deepEqual([run("done", "verified").state, run("done", "verified").verified], ["completed", true]);
  assert.equal(run("done", "unverified").verified, false);
  assert.equal(run("done", "failed").state, "failed");
  assert.match(run("done", "partly").evidence, /only partly verified/);
  assert.equal(run("done", "partly").verified, false);
  // second review: his rejection isn't a failure; a dead "running" row goes uncertain; a loop saved after its slot isn't missed
  const t = (status: string, extra: object) => leadsState({ automation: auto, tasks: [{ status, created_at: iso("09:15"), pending: null, receipt: null, ...extra }] }, now);
  const rej = t("cancelled", { error: "You rejected the proposed actions" });
  assert.deepEqual([rej.state, rej.evidence], ["completed", "you rejected what it proposed"]);
  assert.equal(t("cancelled", { error: "Stopped (Stop-all)" }).state, "failed");
  assert.equal(t("running", { started_at: iso("09:15"), exec: "unknown" }).state, "uncertain", "no worker running it");
  assert.equal(t("running", { started_at: iso("09:15"), exec: "restart" }).state, "uncertain");
  assert.equal(t("running", { started_at: iso("06:00"), exec: "active" }).state, "attempted", "a long run with a live worker is not declared dead by age");
  assert.equal(leadsState({ automation: { ...auto, createdAt: iso("10:00") }, tasks: [] }, now).state, "planned");
});

test("leads: a weekly loop isn't missed on its off days; its last run shows instead", () => {
  const now = at("12:30");
  const lastWeek = at("09:15") - 3 * 86_400_000; // the weekly slot was 3 days ago
  const weekly = { enabled: true, slot: lastWeek, next: null, grace: 3 * 3600_000, label: "Every Monday at 09:15" };
  assert.equal(leadsState({ automation: weekly, tasks: [{ status: "done", created_at: new Date(lastWeek).toISOString(), pending: null, receipt: "verified" }] }, now).state, "completed");
  assert.equal(leadsState({ automation: weekly, tasks: [] }, now).state, "missed", "only when its own slot passed with no run");
});

test("digest: labels only, flags failures; tool text never upgrades a state", () => {
  const v = { day: "2026-11-05", items: [briefState({ briefings: [], runs: [] }, at("12:00")), clipsState([], at("12:00")), leadsState({ automation: null, tasks: [] }, at("12:00"))] };
  const m = digestMsg(v);
  assert.equal(m.kind, "failed");
  assert.match(m.message, /^Brief: MISSED · Clips: nothing new · Leads: off$/);
  assert.match(dailyText(v), /Brief: missed — no run recorded/);
  assert.doesNotMatch(dailyText(v), /, verified/);
});

test("digest due: once a day, from its time, retries at most every 30 min, never stale, off disables", () => {
  const d = "2026-11-05";
  assert.equal(digestDue(undefined, {}, d, at("10:00")), false);
  assert.equal(digestDue("", {}, d, at("10:31")), true, "empty (as .env.example ships it) = 10:30, not off");
  assert.equal(digestDue(undefined, {}, d, at("10:31")), true);
  assert.equal(digestDue(undefined, { sent: d }, d, at("11:00")), false);
  assert.equal(digestDue(undefined, { tried: iso("10:31"), failed: true }, d, at("10:50")), false, "a refused try backs off");
  assert.equal(digestDue(undefined, { tried: iso("10:31"), failed: true }, d, at("11:02")), true);
  assert.equal(digestDue(undefined, { tried: iso("10:31") }, d, at("13:00")), false, "a try that may have landed counts as sent");
  assert.equal(digestDue(undefined, { tried: new Date(at("10:31") - 86_400_000).toISOString() }, d, at("10:31")), true, "yesterday's try doesn't block today");
  assert.equal(digestDue(undefined, {}, d, at("14:31")), false, "more than 4 h late: skipped, not sent at night");
  assert.equal(digestDue("off", {}, d, at("23:00")), false);
  assert.equal(digestDue("8:00", {}, d, at("08:01")), true);
  assert.equal(digestDue("25:00", {}, d, at("23:00")), false);
});
