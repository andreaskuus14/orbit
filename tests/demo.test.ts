import { test } from "node:test";
import assert from "node:assert/strict";
import { demoFor, DEMO_NOW } from "../src/lib/demo-pure.ts";
import { layout, type MapItem, type MapLink } from "../src/lib/memory-map-pure.ts";
import { parseEmbedding } from "../src/lib/memory-world-pure.ts";
import { jobProblem } from "../src/lib/clips/pure.ts";
import { learnProblem, insights, type LearnState } from "../src/lib/clips/learn-pure.ts";
import type { ClipJob } from "../src/lib/clips/types.ts";
import { validateProspect, validatePatch, funnel, type Prospect } from "../src/lib/business-pure.ts";
import { validateGoal, validateSteps, type Goal } from "../src/lib/goals-pure.ts";
import { cleanDays, cleanEmoji, cleanName, isDateKey, type LifeState } from "../src/lib/life-pure.ts";
import { validate, stateAt, type LedgerEvent } from "../src/lib/ledger-pure.ts";
import { validateDevWorld } from "../src/lib/devworld-pure.ts";
import { parseOps } from "../src/lib/arch-pure.ts";
import { validateAutomation } from "../src/lib/pure.ts";
import { geoTag, type Hotspot } from "../src/lib/geo.ts";

const endpoints = ["memories", "memories/map", "memories/map/input", "news/geo", "briefings", "studio", "studio/clips", "studio/clips/learn", "studio/clips/learn/state",
  "agents", "tasks", "goals", "projects", "automations", "analytics", "life", "business", "ledger", "ledger/events", "devworld", "vault", "arch", "arch/scene"];
const get = <T>(path: string): T => demoFor(`/api/${path}`) as T;

test("all demo sections are populated, deterministic, JSON-safe and isolated between calls", () => {
  for (const path of endpoints) {
    const a = get<Record<string, unknown>>(path);
    assert.ok(a && Object.keys(a).length, path);
    assert.ok(Object.values(a).some((v) => Array.isArray(v) && v.length || v && typeof v === "object" && Object.keys(v).length), path);
    assert.deepEqual(a, get(path));
    assert.ok(JSON.stringify(a, (_key, v) => {
      if (typeof v === "number") assert.ok(Number.isFinite(v), path);
      return v;
    }).length > 20);
    a.changed = true;
    assert.equal(get<Record<string, unknown>>(path).changed, undefined);
  }
  assert.equal(demoFor("/api/unknown"), undefined);
});

test("memory embeddings and map inputs pass the existing parser and layout", () => {
  const input = get<{ items: MapItem[]; links: MapLink[] }>("memories/map/input");
  for (const m of input.items) assert.deepEqual(parseEmbedding(m.embedding), m.embedding);
  const pts = layout(input.items, input.links);
  const map = get<{ items: { id: string; x: number; y: number; z: number }[] }>("memories/map");
  assert.equal(map.items.length, input.items.length);
  pts.forEach((p, i) => {
    assert.equal(map.items[i].id, p.id);
    for (const k of ["x", "y", "z"] as const) { assert.ok(Number.isFinite(p[k])); assert.equal(map.items[i][k], p[k]); }
  });
  assert.ok(input.links.every((l) => input.items.some((m) => m.id === l.from) && input.items.some((m) => m.id === l.to)));
});

test("studio jobs and learning stats pass production validators and generate real insights", () => {
  const { jobs } = get<{ jobs: ClipJob[] }>("studio/clips");
  jobs.forEach((j) => assert.equal(jobProblem(j), ""));
  const state = get<LearnState>("studio/clips/learn/state");
  assert.equal(learnProblem(state), "");
  assert.deepEqual(get("studio/clips/learn"), { ...insights(state, jobs), study: null, model: null });
  const values = Object.values(state.clips).map((r) => r.snaps["48h"]!.views);
  assert.ok(values.at(-1)! > values[0] * 10);
  assert.ok(get<{ published: number; top: unknown[] }>("studio/clips/learn").top.length > 0);
});

test("business, goals, life, operations and game fixtures pass existing checks", () => {
  const { prospects, funnel: f } = get<{ prospects: Prospect[]; funnel: unknown }>("business");
  for (const p of prospects) {
    assert.notEqual(typeof validateProspect(p), "string");
    assert.notEqual(typeof validatePatch(p), "string");
    assert.match(p.contact, /@example\.invalid$/);
  }
  assert.deepEqual(f, funnel(prospects));
  assert.ok(funnel(prospects).monthly > 0);
  const roster = get<{ agents: { slug: string }[] }>("agents").agents.map((a) => a.slug);
  for (const g of get<{ goals: Goal[] }>("goals").goals) {
    assert.notEqual(typeof validateGoal(g, roster), "string");
    assert.notEqual(typeof validateSteps(g.steps, roster), "string");
  }
  const life = get<LifeState>("life");
  assert.ok(isDateKey(life.today));
  life.habits.forEach((h) => {
    assert.equal(cleanName(h.name), h.name); assert.equal(cleanEmoji(h.emoji), h.emoji); assert.deepEqual(cleanDays(h.days), h.days);
    assert.ok(h.done.every(isDateKey)); assert.ok(h.streak > 0); assert.equal(h.week.length, 7);
  });
  for (const a of get<{ automations: Record<string, unknown>[] }>("automations").automations) assert.ok("spec" in validateAutomation(a));
  assert.equal(validateDevWorld(get<{ world: unknown }>("devworld").world).ok, true);
  assert.equal(parseOps(JSON.stringify(get("arch"))).length, 1);
});

test("news country tags and every ledger event validate; 180 days show growth", () => {
  const news = get<{ hotspots: Hotspot[] }>("news/geo");
  assert.ok(news.hotspots.length >= 4);
  news.hotspots.forEach((h) => h.stories.forEach((s) => assert.ok(geoTag(s.title).includes(h.name))));
  const { events } = get<{ events: LedgerEvent[] }>("ledger/events");
  assert.equal(new Set(events.map((e) => e.at.slice(0, 10))).size, 180);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  events.forEach((e) => assert.ok("ok" in validate(e), JSON.stringify(e)));
  const end = stateAt(events, DEMO_NOW), early = stateAt(events, events[100].at);
  assert.ok(end.focusMinutes > early.focusMinutes);
  assert.ok(end.counts["core.turn"] > early.counts["core.turn"]);
  assert.ok(end.lastClipOutcomes[0].views > 10000);
  assert.deepEqual(get("ledger"), { at: DEMO_NOW, snapshot: end });
  assert.deepEqual(demoFor("/api/ledger", { at: events[100].at }), { at: events[100].at, snapshot: early });
});

test("query objects and URLSearchParams agree, filter results, and reject invalid time", () => {
  assert.deepEqual(demoFor("/api/memories", { q: "Velquori" }), demoFor("/api/memories?q=Velquori"));
  assert.deepEqual(demoFor("/api/news/geo", { hours: 6 }), demoFor("/api/news/geo", new URLSearchParams("hours=6")));
  const m = demoFor("/api/memories", { q: "Velquori" }) as { results: { title: string }[] };
  assert.ok(m.results.length && m.results.every((r) => r.title.includes("Velquori")));
  assert.deepEqual(demoFor("/api/ledger?at=broken"), { error: "at must be an ISO date-time with a zone" });
});

test("fixtures do not change when the wall clock changes", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const before = endpoints.map((p) => get(p));
  t.mock.timers.setTime(Date.parse("2040-01-01T00:00:00Z"));
  assert.deepEqual(endpoints.map((p) => get(p)), before);
});
