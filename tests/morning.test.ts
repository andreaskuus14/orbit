import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WORDS, buildMorning, pulseHeadlines, shouldAutoShow, studioSection, suggest } from "../src/lib/morning-pure.ts";

const TZ = "Europe/Tallinn";
const NOW = Date.parse("2026-10-16T06:30:00Z"); // 09:30 in Tallinn
const at = (iso: string) => ({ status: "scheduled" as const, at: iso, scheduledFor: iso });

test("pulseHeadlines takes story headlines without verdicts or citations", () => {
  const md = "## World\n### Ceasefire holds in X — Confirmed\ntext [1]\n### Markets dip 🚀 [2] — Single source\n## Yours\n### Roblox ships Y\n### Fourth";
  assert.deepEqual(pulseHeadlines(md), ["Ceasefire holds in X", "Markets dip", "Roblox ships Y"]);
  assert.deepEqual(pulseHeadlines("no headlines"), []);
});

test("studioSection: ready, today's times, yesterday's views, pause", () => {
  const s = studioSection({
    tz: TZ, pausedUntil: NOW + 3600_000, views: { vidA: 1234 }, scout: { newPicks: 2, topNiche: "Speedruns" },
    clips: [
      { title: "a", status: "ready" }, { title: "b", status: "ready" }, { title: "c", status: "approved" },
      { title: "Today **late**", status: "approved", publish: at("2026-10-16T18:00:00Z") },
      { title: "Today early", status: "approved", publish: at("2026-10-16T09:00:00Z") },
      { title: "Yday", status: "approved", publish: { ...at("2026-10-15T14:00:00Z"), videoId: "vidA" } },
      { title: "Yday2", status: "approved", publish: { status: "done", at: "2026-10-15T10:00:00Z", videoId: "vidB" } },
    ],
  }, NOW);
  assert.equal(s.ready, 2);
  assert.equal(s.approved, 1);
  assert.deepEqual(s.today, ["12:00", "21:00"]);
  assert.deepEqual(s.yesterday, [{ title: "Yday2", views: null }, { title: "Yday", views: 1234 }]);
  assert.equal(s.pausedUntil, "10:30");
  assert.equal(s.scout, "2 new scout picks. Top niche: Speedruns.");
});

test("suggest picks one next action by priority", () => {
  const studio = { ready: 0, approved: 3, today: [], yesterday: [], scout: "", pausedUntil: "" };
  assert.equal(suggest({ studio: { ...studio, ready: 2 } }).nav, "review");
  assert.equal(suggest({ studio, agents: { done: [], failed: 0, proposals: ["p"] } }).nav, "agents");
  assert.match(suggest({ studio }).text, /Schedule your 3 approved clips/);
  assert.equal(suggest({ agents: { done: [], failed: 1, proposals: [] } }).nav, "tasks");
  assert.equal(suggest({ intel: { title: "t", at: "", headlines: ["h"] } }).nav, "news");
  assert.equal(suggest({}).nav, null);
});

test("spoken briefing: plain sentences, under the word cap, sections skipped when missing", () => {
  const long = Array.from({ length: 30 }, (_, i) => `Headline number ${i} about something long`);
  const m = buildMorning({
    studio: { ready: 4, approved: 0, today: ["12:00", "17:00"], yesterday: [{ title: "Big one", views: 5000 }], scout: "Top niche: Speedruns.", pausedUntil: "10:30" },
    intel: { title: "Morning Orbit", at: "", headlines: long },
    agents: { done: long, failed: 1, proposals: ["a", "b"] },
  }, NOW, TZ);
  assert.ok(m.spoken.split(/\s+/).length <= MAX_WORDS, m.spoken);
  assert.match(m.spoken, /^Good morning\. You have 4 clips ready to review\. 2 Shorts go live today at 12:00, 17:00\./);
  assert.match(m.spoken, /2 agent proposals are waiting/);
  assert.match(m.spoken, /My suggestion: Review your 4 new clips\.$/);
  assert.doesNotMatch(m.spoken, /[*#_`]/);
  const empty = buildMorning({}, NOW, TZ);
  assert.equal(empty.spoken, "Good morning. My suggestion: Drop a video in the inbox or give your agents a task.");
});

test("auto-show once per local day from 05:00", () => {
  assert.equal(shouldAutoShow(null, new Date(2026, 9, 16, 4, 59)), false);
  assert.equal(shouldAutoShow(null, new Date(2026, 9, 16, 5, 0)), true);
  assert.equal(shouldAutoShow("2026-10-16", new Date(2026, 9, 16, 9, 0)), false);
  assert.equal(shouldAutoShow("2026-10-15", new Date(2026, 9, 16, 9, 0)), true);
});

test("LIFE in the briefing: today's habits, next reminder today only", async () => {
  const { lifeSection } = await import("../src/lib/morning-pure.ts");
  const now = Date.parse("2026-10-16T07:00:00Z"); // 10:00 in Tallinn
  const l = lifeSection({
    habits: [{ scheduledToday: true, doneToday: true }, { scheduledToday: true, doneToday: false }, { scheduledToday: false, doneToday: false }],
    reminders: [
      { text: "Call mom", at: "2026-10-16T15:00:00Z" },
      { text: "Gym", at: "2026-10-16T12:30:00Z" },
      { text: "old", at: "2026-10-16T06:00:00Z" },
      { text: "tomorrow", at: "2026-10-17T09:00:00Z" },
      { text: "fired", at: "2026-10-16T11:00:00Z", fired: "x" },
    ],
  }, now, "Europe/Tallinn");
  assert.deepEqual(l, { habits: 2, done: 1, next: { text: "Gym", at: "15:30" } });
  assert.equal(suggest({ life: l }).nav, "life");
  const m = buildMorning({ life: l }, now, "Europe/Tallinn");
  assert.match(m.spoken, /Reminder at 15:30: Gym\./);
});

test("memory recall: optional spoken sentence, dropped first when over the cap", () => {
  const recall = [{ id: "1", title: "Launch the **pet sim**", label: "1 month ago" }];
  assert.match(buildMorning({ recall }, NOW, TZ).spoken, /From your memory, 1 month ago: Launch the pet sim\. My suggestion/);
  const long = Array.from({ length: 30 }, (_, i) => `Headline number ${i} about something long that keeps going on and on for a while and then some more words here`);
  const m = buildMorning({
    studio: { ready: 4, approved: 0, today: ["12:00"], yesterday: [{ title: "Big one", views: 5000 }], scout: "Top niche: Speedruns.", pausedUntil: "10:30" },
    intel: { title: "x", at: "", headlines: long }, agents: { done: long, failed: 1, proposals: ["a"] }, recall,
  }, NOW, TZ);
  assert.doesNotMatch(m.spoken, /From your memory/);
  assert.match(m.spoken, /YouTube downloads are paused/); // an earlier optional sentence survives
  assert.ok(m.spoken.split(/\s+/).length <= MAX_WORDS);
});
