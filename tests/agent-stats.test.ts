import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateStats, lastDays, dayKey, safeZone, minutesSaved, type TaskRow } from "../src/lib/agent-stats-pure.ts";

const row = (agent: string, status: string, finished: string | null, startedMsBefore = 60_000): TaskRow => ({
  agent, status, created_at: finished ?? "2026-10-16T08:00:00Z",
  started_at: finished ? new Date(Date.parse(finished) - startedMsBefore).toISOString() : null, finished_at: finished,
});

test("local day keys are DST-safe", () => {
  // Europe/Tallinn leaves summer time on 2026-10-25 (a 25 h day): seven distinct consecutive days either side.
  assert.deepEqual(lastDays(new Date("2026-10-27T10:00:00Z"), "Europe/Tallinn"),
    ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.deepEqual(lastDays(new Date("2026-03-31T00:30:00Z"), "Europe/Tallinn"), // spring forward 03-29, already 03-31 locally
    ["2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
  assert.equal(dayKey(new Date("2026-10-15T22:30:00Z"), "Europe/Tallinn"), "2026-10-16"); // after local midnight
  assert.equal(dayKey(new Date("2026-10-15T22:30:00Z"), "UTC"), "2026-10-15");
  assert.equal(safeZone("Not/AZone"), "UTC");
  assert.equal(safeZone(null), "UTC");
  assert.equal(safeZone("Europe/Tallinn"), "Europe/Tallinn");
});

test("aggregation", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const r = aggregateStats([
    row("atlas", "done", "2026-10-16T09:00:00Z", 60_000),
    row("atlas", "done", "2026-10-15T21:30:00Z", 180_000), // 00:30 on the 16th in Tallinn
    row("atlas", "done", "2026-10-01T09:00:00Z"), // outside the week, still counted in done
    row("atlas", "failed", null),
    row("atlas", "running", null),
    row("atlas", "awaiting_approval", null),
    row("atlas", "queued", null),
    row("echo", "done", "2026-10-10T09:00:00Z"),
  ], now, "Europe/Tallinn");
  const a = r.agents.atlas;
  assert.deepEqual({ ...a, last7: undefined }, { done: 3, failed: 1, running: 1, awaiting: 1, avgMs: 100_000, last7: undefined, savedMin: 90 });
  assert.deepEqual(a.last7, [0, 0, 0, 0, 0, 0, 2]);
  assert.deepEqual(r.agents.echo.last7, [1, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.agents.echo.savedMin, minutesSaved("echo"));
  assert.equal(minutesSaved("custom-thing"), 10);
  assert.equal(r.star, "atlas");
});

test("star: ties go to fewer failures, nobody without work this week", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const t = "2026-10-14T10:00:00Z";
  assert.equal(aggregateStats([row("atlas", "done", t), row("atlas", "failed", null), row("forge", "done", t)], now, "UTC").star, "forge");
  assert.equal(aggregateStats([row("atlas", "done", "2026-09-20T10:00:00Z"), row("forge", "failed", null)], now, "UTC").star, null);
  assert.deepEqual(aggregateStats([], now, "UTC"), { agents: {}, star: null });
  assert.equal(aggregateStats([row("nova", "done", null)], now, "UTC").agents.nova.avgMs, null);
});
