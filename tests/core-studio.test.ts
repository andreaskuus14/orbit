import { test } from "node:test";
import assert from "node:assert/strict";
import { actionBlocked, errText, formatStudioStatus, formatLearned, sayTime, isStudioTool, type StudioData } from "../src/lib/core-studio.ts";

const NOW = Date.parse("2026-10-16T10:00:00Z"); // 13:00 in Tallinn
const base: StudioData = { ready: 6, approved: 2, scheduled: [], running: [], downloadsFailed: 0, downloadsActive: 0, ytPausedUntil: 0,
  scoutRunning: false, batch: null, tz: "Europe/Tallinn" };

test("status: speakable summary with next 3 slots", () => {
  const s = formatStudioStatus({ ...base,
    scheduled: ["2026-10-16T14:00:00Z", "2026-10-17T09:00:00Z", "2026-10-20T18:00:00Z", "2026-10-21T09:00:00Z"],
    running: [{ name: "stream", progress: 42.4 }], downloadsFailed: 1, ytPausedUntil: NOW + 3600_000,
    scout: { at: "x", ok: true, summary: "5 picks." }, topNiche: "Speedrun fails" }, NOW);
  assert.match(s, /^6 clips ready to review, 2 approved/);
  assert.match(s, /Next Shorts go live at 17:00, tomorrow 12:00, Tue 21:00\./);
  assert.match(s, /stream at 42%/);
  assert.match(s, /paused until 14:00/);
  assert.match(s, /1 download failed/);
  assert.match(s, /Last scout run: 5 picks\. /);
  assert.match(s, /Top niche: Speedrun fails\.$/);
});

test("status: empty studio and running batch / failed scout", () => {
  assert.equal(formatStudioStatus({ ...base, ready: 1, approved: 0 }, NOW), "1 clip ready to review, 0 approved and not yet published. Nothing is scheduled.");
  const s = formatStudioStatus({ ...base, batch: { running: true, total: 3, scheduled: 1, at: "" }, scout: { at: "", ok: false, error: "No API key" } }, NOW);
  assert.match(s, /1 of 3 done/);
  assert.match(s, /last scout run failed: No API key/);
});

test("sayTime", () => {
  assert.equal(sayTime("2026-10-16T14:00:00Z", "Europe/Tallinn", NOW), "17:00");
  assert.equal(sayTime("2026-10-17T09:00:00Z", "Europe/Tallinn", NOW), "tomorrow 12:00");
});

test("learned", () => {
  assert.match(formatLearned({ published: 0, top: [] }, ""), /No published clips.*\nNot enough/);
  const s = formatLearned({ published: 4, top: [{ videoId: "a", title: "Big fail", views72: 12000, score: 1, avgViewPct: 81 }] }, "Owner rejects: boring (3).");
  assert.match(s, /"Big fail" \(12,000 views in 3 days, 81% watched\)/);
  assert.match(s, /Owner rejects/);
});

test("action guard: needs the user's own words and no untrusted content first", () => {
  assert.ok(isStudioTool("run_scout") && !isStudioTool("fetch_url"));
  assert.equal(actionBlocked("studio_status", "", true), "");
  assert.equal(actionBlocked("learned", "what works?", false), "");
  assert.equal(actionBlocked("run_scout", "run the scout", false), "");
  assert.equal(actionBlocked("run_scout", "Hey Orbit, start scouting now", false), "");
  assert.notEqual(actionBlocked("run_scout", "how's the scout doing?", false), "");
  assert.notEqual(actionBlocked("run_scout", "run the scout", true), "");
  assert.equal(actionBlocked("run_niche", "start the niche research", false), "");
  assert.notEqual(actionBlocked("run_niche", "what's my top niche?", false), "");
  assert.equal(actionBlocked("schedule_approved", "schedule all approved clips", false), "");
  assert.equal(actionBlocked("schedule_approved", "ok schedule them", false), "");
  assert.notEqual(actionBlocked("schedule_approved", "what's scheduled?", false), "");
  assert.notEqual(actionBlocked("schedule_approved", "yes", false), "");
  for (const q of ["how did the last scout run go?", "what does the scout do", "why didn't the scout find anything", "Hey Orbit, did the scout run", "is the scout running"])
    assert.notEqual(actionBlocked("run_scout", q, false), "", q);
  for (const q of ["what's the schedule for the approved clips?", "what's the schedule for the approved clips", "did you schedule them", "when do you schedule my clips"])
    assert.notEqual(actionBlocked("schedule_approved", q, false), "", q);
  assert.equal(actionBlocked("schedule_approved", "schedule my approved clips", false), "");
  assert.equal(actionBlocked("run_scout", "Please kick off a new scout", false), "");
});

test("errText hides local paths and raw fs errors", () => {
  assert.equal(errText(Object.assign(new Error("ENOENT: no such file, open 'C:\\Users\\a\\orbit-studio\\x.json'"), { code: "ENOENT" })), "the studio folder or a file in it is missing");
  assert.match(errText(Object.assign(new Error("EBUSY /home/a/s.json"), { code: "EBUSY" })), /locked/);
  assert.equal(errText(new Error("failed at /home/a/orbit-studio/clips/x.mp4 now")), "failed at a studio file now");
  assert.equal(errText(new Error("The scout is already running")), "The scout is already running");
});

test("'find my niche' (the button's words) is an allowed imperative; questions still refused", async () => {
  const { actionBlocked } = await import("../src/lib/core-studio.ts");
  assert.equal(actionBlocked("run_niche", "find my niche", false), "");
  assert.equal(actionBlocked("run_niche", "Hey Orbit, find a new niche", false), "");
  assert.notEqual(actionBlocked("run_niche", "did you find my niche?", false), "");
});
