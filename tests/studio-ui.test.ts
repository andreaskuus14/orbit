import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIP_TABS, NO_AUTO, PROD_SECONDARY, STUDIO_MODES, autoCount, autoLine, parseClipTab, rank, reviewQueue, startAt } from "../src/lib/studio-ui-pure.ts";
import { splitTabs } from "../src/lib/ui-state-pure.ts";
import { EN, ET, type Key } from "../src/lib/i18n-pure.ts";

test("STUDIO shows Channel · Shorts · Stats; the rest sit behind More, and nothing is dropped", () => {
  const { row, more } = splitTabs(STUDIO_MODES, "channel");
  assert.deepEqual(row.map((m) => m.id), ["channel", "clips", "stats"]);
  assert.deepEqual(more.map((m) => m.id), ["production", "sites", "other"]);
  assert.equal(new Set(STUDIO_MODES.map((m) => m.id)).size, 6);
  // the open section always shows in the row
  assert.deepEqual(splitTabs(STUDIO_MODES, "sites").row.map((m) => m.id), ["channel", "clips", "stats", "sites"]);
  for (const m of STUDIO_MODES) assert.ok(EN[m.label as Key] && ET[m.label as Key], m.label);
});

test("Shorts tabs: Find · Review · Scheduled, every old tab still reachable", () => {
  const { row, more } = splitTabs(CLIP_TABS, "find");
  assert.deepEqual(row.map((t) => t.id), ["find", "clips", "calendar"]);
  assert.deepEqual([...row, ...more].map((t) => t.id).sort(), ["autopilot", "calendar", "clips", "find", "insights", "longform", "pipeline", "story"]);
  assert.equal(parseClipTab("story"), "story"); // a tab saved before this change still opens
  assert.equal(parseClipTab("review"), null);
  assert.equal(parseClipTab(null), null);
  assert.ok(PROD_SECONDARY.has("ideas") && PROD_SECONDARY.has("calendar") && !PROD_SECONDARY.has("review"));
});

const clip = (id: string, status: string, score: number, v?: number) => ({ id, status, score, ...(v === undefined ? {} : { virality: { score: v } }) });

test("one review queue: ready clips plus the autopilot's approved-but-waiting ones, best first", () => {
  const jobs = [
    { id: "j1", createdAt: "2026-11-01", clips: [clip("a", "ready", 0.5), clip("b", "approved", 0.9), clip("c", "rejected", 1)] },
    { id: "j2", createdAt: "2026-11-02", clips: [clip("d", "ready", 50), clip("e", "ready", 0.1, 80), clip("f", "approved", 0.2)] },
  ];
  assert.deepEqual(reviewQueue(jobs).map((x) => x.clip.id), ["e", "d", "a"]); // e by virality 80; d and a tie at 50, newer job first
  const q = reviewQueue(jobs, new Set(["j1/b"]));
  assert.deepEqual(q.map((x) => `${x.job.id}/${x.clip.id}`), ["j1/b", "j2/e", "j2/d", "j1/a"]);
  assert.equal(startAt(q, "j2/d"), 2);
  assert.equal(startAt(q, "gone/x"), 0);
  assert.equal(startAt(q), 0);
  assert.equal(rank(clip("x", "ready", 0.42)), 42);
  assert.equal(rank(clip("x", "ready", Number.NaN)), 0);
});

test("autopilot status line: one sentence of what runs by itself", () => {
  assert.deepEqual(autoLine(NO_AUTO), []);
  assert.equal(autoCount(NO_AUTO), 0);
  const s = { ...NO_AUTO, autopilot: true, creators: { auto: 2, total: 3 }, inbox: false, niche: true, devlog: false, publish: "ask" as const, publishPerDay: 1 };
  assert.deepEqual(autoLine(s).map((p) => p.key), ["sa.line.on", "sa.line.creators", "sa.line.niche", "sa.line.postsNone"]);
  assert.equal(autoLine(s)[1].vars?.n, 2);
  assert.equal(autoCount(s), 3);
  const posting = autoLine({ ...s, autopilot: false, publish: "auto", publishPerDay: 2 });
  assert.equal(posting[0].key, "sa.line.off");
  assert.deepEqual(posting.at(-1), { key: "sa.line.posts", vars: { n: 2 } });
  for (const p of [...autoLine(s), ...posting]) assert.ok(EN[p.key as Key] && ET[p.key as Key], p.key);
});
