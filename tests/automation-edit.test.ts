import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAutomationPatch, automationCapabilityHint, automationDraft, automationSpec } from "../src/lib/automation-edit-pure.ts";
import type { AutomationSpec } from "../src/lib/pure.ts";

const current: AutomationSpec = { name: "Daily news", agent: "forge", prompt: "Write a short summary", trigger: "schedule", schedule: { every: "week", hour: 18, minute: 30, weekday: 5 }, event: null, kind_filter: null };
const good = (input: unknown, base = current) => { const r = validateAutomationPatch(input, base); assert.ok("patch" in r, JSON.stringify(r)); return r.patch; };

for (const [field, value] of [
  ["name", ""], ["name", " "], ["name", 3], ["name", "x".repeat(101)],
  ["prompt", "four"], ["prompt", null], ["prompt", "x".repeat(4001)],
  ["agent", ""], ["agent", "Bad Agent!"], ["agent", null],
  ["enabled", "false"], ["enabled", null], ["trigger", "cron"],
  ["event", "anything.else"], ["kind_filter", "Bad Kind"], ["kind_filter", 9],
  ["schedule", []], ["schedule", "daily"], ["schedule", { every: "month" }],
  ["schedule", { every: ["hour"] }], ["schedule", { every: { toString: 5 } }],
  ["schedule", { hour: 24 }], ["schedule", { hour: -1 }], ["schedule", { minute: 60 }],
  ["schedule", { weekday: 7 }], ["schedule", { minute: 2.5 }], ["schedule", { hour: null }],
  ["schedule", { minute: "" }], ["schedule", { timezone: "UTC" }],
  ["user_id", "someone-else"], ["run_count", 0], ["last_run_at", null],
] as const) test(`PATCH rejects ${field} = ${JSON.stringify(value).slice(0, 45)}`, () => {
  assert.ok("error" in validateAutomationPatch({ [field]: value }, current));
});

test("each text field is validated without rewriting other fields or run metadata", () => {
  assert.deepEqual(good({ name: " New name " }), { name: "New name" });
  assert.deepEqual(good({ prompt: " New instructions " }), { prompt: "New instructions" });
  assert.deepEqual(good({ agent: "pulse" }), { agent: "pulse" });
  assert.deepEqual(good({ enabled: false }), { enabled: false });
  assert.deepEqual(good({ name: "New", agent: "pulse", prompt: "Check live news", enabled: true }), { name: "New", agent: "pulse", prompt: "Check live news", enabled: true });
});
test("enabled-only patch preserves legacy malformed specs and false never becomes true", () => {
  const legacy = { ...current, name: "", agent: "missing", prompt: "", schedule: null };
  assert.deepEqual(good({ id: "id", enabled: false }, legacy), { enabled: false });
  assert.ok("error" in validateAutomationPatch({ enabled: false, name: "" }, legacy));
});
test("partial schedule merges existing fields and keeps midnight, zero minute and Sunday", () => {
  const patch = good({ schedule: { hour: "0", minute: "0", weekday: "0" } });
  assert.deepEqual(patch.schedule, { every: "week", hour: 0, minute: 0, weekday: 0 });
  assert.deepEqual(good({ schedule: { minute: 12 } }).schedule, { ...current.schedule, minute: 12 });
});
test("switching schedule/event clears stale fields and validates event/filter", () => {
  const patch = good({ trigger: "event", event: "memory.created", schedule: null, kind_filter: "document" });
  assert.deepEqual(patch, { trigger: "event", event: "memory.created", schedule: null, kind_filter: "document" });
  const event: AutomationSpec = { ...current, ...patch } as AutomationSpec;
  assert.deepEqual(good({ event: "briefing.ready" }, event), { trigger: "event", event: "briefing.ready", schedule: null, kind_filter: null });
  assert.deepEqual(good({ trigger: "schedule", schedule: { every: "hour", minute: 15 } }, event), { trigger: "schedule", schedule: { every: "hour", minute: 15 }, event: null, kind_filter: null });
  assert.ok("error" in validateAutomationPatch({ trigger: "event" }, current));
  assert.ok("error" in validateAutomationPatch({ event: "briefing.ready" }, current));
  assert.ok("error" in validateAutomationPatch({ schedule: { every: "day" } }, event));
  assert.ok("error" in validateAutomationPatch({ schedule: null }, current));
});
test("empty, non-object and metadata-only patches cannot make a write", () => {
  for (const value of [null, [], "bad", {}, { id: "id" }]) assert.ok("error" in validateAutomationPatch(value, current));
});
for (const spec of [
  current, { ...current, schedule: { every: "day" as const, hour: 0, minute: 0 } },
  { ...current, schedule: { every: "hour" as const, minute: 59 } },
  { ...current, schedule: null, trigger: "event" as const, event: "memory.created" as const, kind_filter: "document" },
  { ...current, schedule: null, trigger: "event" as const, event: "briefing.ready" as const },
]) test(`inline draft round trip: ${JSON.stringify(spec.schedule ?? spec.event)}`, () => {
  assert.deepEqual(automationSpec(automationDraft(spec)), spec);
});

const forge = { slug: "forge", name: "Forge", tools: ["search_memory", "save_memory"] };
test("capability hint warns when Forge is asked for live news, without pretending it has no write tools", () => {
  const hint = automationCapabilityHint(forge, "Check the latest news on Ukraine and Roblox today");
  assert.match(hint!, /Forge.*can't look up live news/);
  assert.doesNotMatch(hint!, /only read memory|\n/);
  assert.equal(automationCapabilityHint(forge, "Using today's news briefings in my memory, write 3 YouTube ideas"), null);
  assert.equal(automationCapabilityHint(forge, "Write an outline for my game"), null);
});
test("hints use real tools, including custom and delegation capabilities, not agent names", () => {
  for (const tools of [["read_news"], ["news_search"], ["run_pulse"], ["delegate"]]) assert.equal(automationCapabilityHint({ slug: "custom", name: "My researcher", tools }, "Find the latest news"), null);
  assert.match(automationCapabilityHint({ ...forge, tools: ["search_articles"] }, "Look up live news")!, /no live-news tools/);
  assert.match(automationCapabilityHint(forge, "Read https://example.com")!, /no web tools/);
  assert.equal(automationCapabilityHint({ ...forge, tools: ["fetch_url"] }, "Read https://example.com"), null);
  assert.match(automationCapabilityHint({ slug: "pulse", name: "Pulse", tools: ["news_search"] }, "Summarize my memories")!, /no memory-reading tools/);
});
test("unknown and disabled agents are visibly unavailable", () => {
  assert.match(automationCapabilityHint(undefined, "Write something")!, /unavailable/);
  assert.match(automationCapabilityHint({ ...forge, enabled: false }, "Write something")!, /unavailable/);
});
