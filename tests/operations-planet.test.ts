import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OPS_COPY, buckets, counts, dur, errorLine, historyGroups, historyView, kindOf, lanes, listTag, logLines, nextRun, oneAtATime, plainApiError, ringShare,
  routineRun, routineSave, routineToggle, sheetFromView, slimTask, statusText, stepRows, triggerText, type OpsTask,
} from "../src/lib/operations-planet-pure.ts";

const NOW = Date.parse("2026-11-23T10:00:00Z"), MIN = 60_000;
const iso = (m: number) => new Date(NOW - m * MIN).toISOString();
const job = (o: Partial<OpsTask> & { status: string; ago?: number }): OpsTask => ({ id: Math.random().toString(36).slice(2), agent: "nova", title: "Job", created_at: iso(o.ago ?? 10),
  started_at: o.status === "queued" ? null : iso((o.ago ?? 10) - 0.5), finished_at: ["done", "failed", "cancelled"].includes(o.status) ? iso((o.ago ?? 10) - 5) : null, trace: [], ...o });

test("kinds follow the shared status vocabulary; Stop-all holds running work", () => {
  assert.equal(kindOf({ status: "awaiting_approval" }), "needs");
  assert.equal(kindOf({ status: "running" }), "working");
  assert.equal(kindOf({ status: "running" }, { stopAll: true }), "queued");
  assert.equal(kindOf({ status: "done" }), "done");
  assert.equal(kindOf({ status: "cancelled" }), "stopped");
  assert.equal(kindOf({ status: "weird" }), "queued"); // unknown never claims progress
});

test("buckets: needs, working (oldest first), queued, failed only from the last 24 h; sub-tasks never listed", () => {
  const a = job({ status: "running", ago: 5 }), b = job({ status: "running", ago: 30 }), old = job({ status: "failed", ago: 26 * 60 }), fresh = job({ status: "failed", ago: 30 });
  const sub = { ...job({ status: "running" }), parent_id: a.id };
  const r = buckets([a, b, old, fresh, sub, job({ status: "awaiting_approval" }), job({ status: "queued" }), job({ status: "done" })], NOW);
  assert.deepEqual(r.working.map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(r.failed.map((x) => x.id), [fresh.id]);
  assert.equal(r.needs.length, 1); assert.equal(r.queued.length, 1); assert.equal(r.history.length, 3);
  const c = counts([a, b, old, fresh, job({ status: "done" })], NOW);
  assert.deepEqual([c.working, c.failed, c.done], [2, 1, 1]);
  assert.equal(statusText(c, "en"), "2 working · 1 done today");
  assert.equal(statusText({ working: 0, needs: 0, done: 0, failed: 0, queued: 0 }, "et"), OPS_COPY.et.idle);
});

test("timeline lanes: bars inside 0..1, open jobs run to the now line, old ones are left out", () => {
  const run = job({ status: "running", ago: 60 }), done = job({ status: "done", ago: 120 }), gone = job({ status: "done", ago: 12 * 60 });
  const t = lanes([run, done, gone], NOW, { spanH: 6, aheadH: 0.5 });
  assert.equal(t.lanes.length, 2);
  const r = t.lanes.find((l) => l.id === run.id)!;
  assert.ok(r.open && Math.abs(r.to - t.now) < 1e-9);
  for (const l of t.lanes) assert.ok(l.from >= 0 && l.to <= 1 && l.to > l.from);
  assert.ok(t.ticks.length >= 6);
});

test("step rows: real times from started_at + lengths, a now row while working, tool names in plain words", () => {
  const t = job({ status: "running", ago: 10, trace: [{ step: "think", ms: 3000 }, { step: "web_search", ms: 60_000 }, { step: "route", ms: 5 }, { step: "fetch_url", ms: 1000, ok: false }] });
  const rows = stepRows(t, "en", NOW);
  assert.deepEqual(rows.map((r) => r.label), ["Thinking it through", "Searching the web", "Reading pages", "Next step"]);
  assert.equal(rows[1].at! - rows[0].at!, 3000);
  assert.deepEqual(rows.map((r) => r.state), ["done", "done", "failed", "now"]);
  assert.ok(!JSON.stringify(rows).includes("web_search"));
  assert.equal(stepRows(job({ status: "queued" }), "et", NOW)[0].state, "next");
});

test("durations and ring share never invent data", () => {
  assert.equal(dur(3800, "en"), "3.8 s"); assert.equal(dur(161_000, "en"), "2 min 41 s"); assert.equal(dur(3_840_000, "et"), "1 t 4 min"); assert.equal(dur(null, "en"), "—");
  assert.equal(ringShare(job({ status: "done" })), 1);
  assert.equal(ringShare(job({ status: "queued" })), 0);
  assert.equal(ringShare(job({ status: "running", trace: [] })), 0);
  assert.ok(ringShare(job({ status: "running", trace: [{ step: "think" }, { step: "draft" }] })) < 1);
});

test("errors and log lines are plain words: no stack, path or internal name", () => {
  const t = job({ status: "failed", error: "fetch failed: ETIMEDOUT at Socket.<anonymous> (/home/x/node_modules/undici/lib/core.js:12:3)",
    trace: [{ step: "fetch_url", ms: 10, ok: false, detail: "ECONNREFUSED 127.0.0.1:11434" }] });
  const e = errorLine(t, "en");
  assert.doesNotMatch(e, /ETIMEDOUT|node_modules|\/home|Socket/);
  const log = logLines(t, "en");
  assert.equal(log[0].level, "warn"); assert.doesNotMatch(log[0].text, /fetch_url|ECONNREFUSED/);
  assert.equal(errorLine({ error: null }, "et"), OPS_COPY.et.failedPlain);
  assert.equal(plainApiError("Stop-all is on", "x"), "Stop-all is on");
  assert.equal(plainApiError("Request failed (500)", "fallback"), "fallback");
});

test("history: Tallinn days, search and status filter", () => {
  const a = job({ status: "done", title: "Morning brief", ago: 30 }), b = job({ status: "failed", title: "Shop prices", ago: 26 * 60 });
  const g = historyGroups([a, b], "en", NOW);
  assert.equal(g[0].label, "Today"); assert.equal(g[1].label, "Yesterday");
  assert.equal(historyGroups([a], "et", NOW)[0].label, "Täna");
  assert.deepEqual(historyView([a, b], "shop", "all").map((x) => x.id), [b.id]);
  assert.deepEqual(historyView([a, b], "", "done").map((x) => x.id), [a.id]);
});

test("routines read in his language; next run uses the Tallinn clock; paused has none", () => {
  const day = { trigger: "schedule" as const, schedule: { every: "day" as const, hour: 17, minute: 0 }, event: null, kind_filter: null };
  assert.equal(triggerText(day, "en"), "Every day at 17:00");
  assert.equal(triggerText(day, "et"), "Iga päev kell 17:00");
  assert.equal(triggerText({ ...day, schedule: { every: "week", weekday: 0, hour: 18, minute: 0 } }, "et"), "Igal pühapäeval kell 18:00");
  assert.equal(triggerText({ trigger: "event", schedule: null, event: "memory.created", kind_filter: "document" }, "en"), "When you save a document");
  assert.equal(nextRun({ enabled: true, ...day }, "en", new Date(NOW)), "Today 17:00"); // 10:00 UTC = 12:00 Tallinn
  assert.equal(nextRun({ enabled: false, ...day }, "en", new Date(NOW)), null);
});

test("routine requests keep the old contracts: edit never enables, toggle sends only enabled, run sends only the id", async () => {
  const spec = { name: "N", prompt: "Do the thing", agent: "nova" };
  assert.deepEqual(routineSave("a1", spec), { method: "PATCH", body: { id: "a1", ...spec } });
  assert.ok(!("enabled" in routineSave("a1", spec).body));
  assert.equal(routineSave(null, spec).method, "POST");
  assert.deepEqual(routineToggle({ id: "a1", enabled: false }), { method: "PATCH", body: { id: "a1", enabled: true } });
  assert.deepEqual(routineRun({ id: "a1" }), { method: "POST", body: { run: "a1" } });
  const once = oneAtATime(); let n = 0;
  const slow = () => new Promise<number>((r) => setTimeout(() => r(++n), 10));
  const [x, y] = await Promise.all([once("run:a1", slow), once("run:a1", slow)]);
  assert.equal(n, 1); assert.equal(x, 1); assert.equal(y, undefined);
});

test("slim list: no step details, result cut; tag changes only when a row moves", () => {
  const row = { id: "1", status: "running", title: "J", result: "x".repeat(5000), request: "r", error: null, trace: [{ step: "think", ms: 5, ok: true, detail: "secret detail" }], pending: [], started_at: iso(1), finished_at: null };
  const s = slimTask(row);
  assert.equal(s.result!.length, 400); assert.ok(!JSON.stringify(s).includes("secret detail"));
  const t1 = listTag([row]);
  assert.equal(listTag([{ ...row }]), t1);
  assert.notEqual(listTag([{ ...row, trace: [...row.trace, { step: "draft", ms: 1, ok: true, detail: "" }] }]), t1);
  assert.notEqual(listTag([{ ...row, status: "done" }]), t1);
});

test("deep links: old tab names land in the new place", () => {
  assert.deepEqual(sheetFromView("scout"), { sheet: "scout" });
  assert.deepEqual(sheetFromView("automations"), { tab: "scheduled" });
  assert.deepEqual(sheetFromView("plans"), { sheet: "plans" });
  assert.deepEqual(sheetFromView("<x>"), {});
});

test("copy: EN and ET have the same keys and no empty strings", () => {
  const keys = (o: object) => Object.keys(o).sort();
  assert.deepEqual(keys(OPS_COPY.et), keys(OPS_COPY.en));
  for (const [k, v] of Object.entries(OPS_COPY.et)) if (typeof v === "string") assert.ok(v.trim(), k);
  assert.equal(OPS_COPY.et.days.length, 7); assert.equal(OPS_COPY.et.sugg.length, 3);
  assert.deepEqual(keys(OPS_COPY.et.tabs), keys(OPS_COPY.en.tabs)); assert.deepEqual(keys(OPS_COPY.et.tpl), keys(OPS_COPY.en.tpl));
});
