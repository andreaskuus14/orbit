import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, dailySeries, dayKey, modelName, parseDays, purposeArea, usageGroups } from "../src/lib/analytics-summary-pure.ts";
import { EN, ET } from "../src/lib/i18n-pure.ts";
import type { TaskRow } from "../src/lib/analytics-outcomes-pure.ts";

const NOW = Date.parse("2026-11-24T10:00:00Z"), D = 86_400_000;
const task = (i: number, status: string, ago: number, o: Partial<TaskRow> = {}): TaskRow => ({
  id: `t${i}`, parent_id: null, agent: "nova", title: `Task ${i}`, status, created_at: new Date(NOW - ago * D).toISOString(),
  started_at: new Date(NOW - ago * D).toISOString(), finished_at: new Date(NOW - ago * D + 60_000).toISOString(), error: status === "failed" ? "Timed out 12" : null, ...o,
});

test("parseDays: only 7 or 30", () => {
  assert.equal(parseDays("30"), 30); assert.equal(parseDays(30), 30); assert.equal(parseDays("90"), 7); assert.equal(parseDays(null), 7);
});

test("model names are readable, never raw ids", () => {
  assert.equal(modelName("claude-opus-4-1-20250805"), "Claude Opus 4.1");
  assert.equal(modelName("claude-sonnet-4-5"), "Claude Sonnet 4.5");
  assert.equal(modelName("claude-3-5-haiku-latest"), "Claude Haiku 3.5");
  assert.equal(modelName("claude-haiku"), "Claude Haiku");
  assert.equal(modelName("qwen2.5:7b"), "Qwen 2.5 (local)");
  assert.equal(modelName("ollama:llama3"), "Llama 3 (local)");
  assert.equal(modelName("gpt-something"), "Other model");
  assert.equal(modelName(""), "Unknown model");
});

test("purposes map to areas; agents keep their name; unknown is other", () => {
  assert.deepEqual(purposeArea("agent.nova.review"), { area: "agents", agent: "Nova" });
  assert.deepEqual(purposeArea("agent.deal-hunter"), { area: "agents", agent: "Deal Hunter" });
  assert.deepEqual(purposeArea("clips.dub"), { area: "studio" });
  assert.deepEqual(purposeArea("core.web_search"), { area: "core" });
  assert.deepEqual(purposeArea("pulse.morning"), { area: "briefing" });
  assert.deepEqual(purposeArea("something-new"), { area: "other" });
  assert.deepEqual(purposeArea(null), { area: "other" });
});

test("every area and every label key exists in EN and ET", () => {
  for (const a of ["core", "agents", "studio", "research", "briefing", "goals", "business", "memory", "life", "upkeep", "other", "agent"])
    assert.ok(`ana.area.${a}` in EN && ET[`ana.area.${a}` as keyof typeof ET], a);
  const ana = Object.keys(EN).filter((k) => k.startsWith("ana."));
  assert.deepEqual(ana.filter((k) => !ET[k as keyof typeof ET]), []);
});

test("usageGroups merges by area + model and sums tokens; metered cost only when > 0", () => {
  const g = usageGroups([
    { model: "claude-opus-4-1", purpose: "core", input_tokens: 100, output_tokens: 50, cost_usd: 0 },
    { model: "claude-opus-4-1", purpose: "core.verify", input_tokens: "10" as unknown as number, output_tokens: 5, cost_usd: "0.5" },
    { model: "claude-haiku-4-5", purpose: "agent.nova", input_tokens: 1, output_tokens: 1, cost_usd: null },
  ]);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { area: "core", model: "Claude Opus 4.1", calls: 2, tokens: 165, usd: 0.5 });
  assert.equal(g[1].agent, "Nova");
});

test("dailySeries: one point per Tallinn day, oldest first; sub-tasks and open work left out", () => {
  const s = dailySeries([task(1, "done", 0), task(2, "failed", 1), task(3, "queued", 0), task(4, "done", 0, { parent_id: "t1" }), task(5, "done", 40)],
    [{ model: "m", purpose: "core", input_tokens: 5, output_tokens: 5, cost_usd: 0, created_at: new Date(NOW).toISOString() }], 7, NOW);
  assert.equal(s.length, 7);
  assert.equal(s[6].date, dayKey(NOW));
  assert.deepEqual(s[6], { date: dayKey(NOW), done: 1, failed: 0, tokens: 10 });
  assert.equal(s[5].failed, 1);
  assert.equal(s.reduce((a, p) => a + p.done, 0), 1);
  assert.equal(dailySeries([], null, 30, NOW).length, 30);
});

test("buildSummary: small reply, unknown stays null, records capped, usage null when unreadable", () => {
  const tasks = Array.from({ length: 60 }, (_, i) => task(i, i % 4 === 0 ? "failed" : "done", i % 7, { title: `Job ${i}` }));
  const s = buildSummary({ days: 7, now: NOW, tasks, tasksCapped: false, chains: new Set(), usage: null, projects: new Map(),
    calibration: { manual: {}, touch: null }, experiments: [], queued: {}, events: [{ type: "agent.completed", created_at: new Date(NOW).toISOString() }], modelRunRows: null, counts: { memories: 3, messages: null } });
  assert.equal(s.outcomes.finished, 60);
  assert.ok(s.outcomes.accepted.items.length <= 20);
  assert.equal(s.saved, null); // not calibrated → unknown, never 0
  assert.equal(s.usage, null);
  assert.equal(s.models, null);
  assert.equal(s.cost.metered, null);
  assert.ok(s.reliability.every((r) => r.success.items.length === 0));
  assert.equal(s.worst?.error, "Timed out #");
  assert.equal(s.events[0].type, "agent.completed");
  assert.ok(JSON.stringify(s).length < 20_000);
  const empty = buildSummary({ days: 30, now: NOW, tasks: [], tasksCapped: false, chains: new Set(), usage: [], projects: new Map(),
    calibration: { manual: {}, touch: null }, experiments: [], queued: {}, events: [], modelRunRows: [], counts: { memories: null, messages: null } });
  assert.equal(empty.outcomes.accepted.pct, null);
  assert.equal(empty.daily.length, 30);
  assert.deepEqual(empty.usage, []);
});

test("buildSummary: time saved from his minutes; model runs named readably", () => {
  const tasks = [task(1, "done", 1, { pending: [{ status: "approved", evidence: ["x"] }] }), task(2, "done", 2, { pending: [{ status: "approved" }] })];
  const s = buildSummary({ days: 7, now: NOW, tasks, tasksCapped: false, chains: new Set(), usage: [], projects: new Map(),
    calibration: { manual: { single: 30 }, touch: 5 }, experiments: [], queued: {}, events: [],
    modelRunRows: [{ id: "1", created_at: new Date(NOW - D).toISOString(), type: "model.run", planet: "agents", payload: { kind: "agent", job: "send", model: "claude-haiku-4-5", risky: true, why: ["risk:send"] } }],
    counts: { memories: 0, messages: 0 } });
  assert.equal(s.saved?.minutes, 2 * 30 - 2 * 5);
  assert.equal(s.models?.below, 1);
  assert.equal(s.models?.perModel[0].name, "Claude Haiku 4.5");
});
