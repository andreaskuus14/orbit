import { test } from "node:test";
import assert from "node:assert/strict";
import { CALL, CALL_START, decideCall, parseCallState, validReview, cleanOpener, type CallState } from "../src/lib/call-pure.ts";
import {
  REVIEW_START, ASK_PRIORITIES, missedReviewDue, missedReviewLine, parsePriorities, priorityGoal, readBack, reviewOpener, reviewSummary, reviewTurn, reviewWeeksAgo,
  type ReviewSummary,
} from "../src/lib/review-call-pure.ts";
import type { Week } from "../src/lib/week-pure.ts";

// 2026-10-25 is a Sunday; after the DST switch Tallinn = UTC+2.
const at = (h: number, m = 0, d = 25) => Date.UTC(2026, 9, d, h - 2, m);
const sig = (now: number, o: Partial<{ approvals: string[]; stopAll: boolean }> = {}) => ({ now, stopAll: false, approvals: [], nightReport: false, ...o });
const on: CallState = { ...CALL_START, review: { on: true, day: 0, at: "19:00" } };

test("weekly review rings once on his day and time, never retries", () => {
  assert.equal(decideCall({ ...on, review: { on: false, day: 0, at: "19:00" } }, sig(at(19, 5))).ring, null); // off by default
  assert.equal(decideCall(on, sig(at(18, 55))).ring, null); // not yet
  assert.equal(decideCall(on, sig(at(19, 5), { stopAll: true })).ring, null);
  assert.equal(decideCall(on, sig(at(19, 5, 26))).ring, null); // Monday: wrong day
  const r = decideCall(on, sig(at(19, 5)));
  assert.equal(r.ring?.reason, "review");
  assert.equal(r.state.reviewDay, "2026-10-25");
  assert.equal(r.state.reviewAt, at(19, 5));
  assert.equal(decideCall(r.state, sig(at(20, 30))).ring, null); // unanswered: no second ring
  // the daily cap doesn't hide the slot he picked
  assert.equal(decideCall({ ...on, day: "2026-10-25", calls: CALL.maxPerDay, lastAt: at(9) }, sig(at(19, 5))).ring?.reason, "review");
  assert.equal(decideCall(on, sig(at(21, 30))).ring, null); // past the window
});

test("review settings validate and survive the state file", () => {
  assert.deepEqual(validReview({ on: true, day: 3, at: "08:30" }), { on: true, day: 3, at: "08:30" });
  assert.equal(validReview({ on: true, day: 7, at: "19:00" }), null);
  assert.equal(validReview({ on: true, day: 0, at: "23:30" }), null); // quiet hours
  assert.equal(validReview({ on: "yes", day: 0, at: "19:00" }), null);
  const back = parseCallState(JSON.stringify({ ...on, reviewDay: "2026-10-25", reviewAt: 5 }));
  assert.deepEqual([back.review, back.reviewDay, back.reviewAt], [on.review, "2026-10-25", 5]);
  assert.equal(parseCallState(JSON.stringify({ review: { on: 1 } })).review, undefined);
});

const week: Week = { from: "2026-10-19", to: "2026-10-25", days: 7, facts: [
  { kind: "done", text: "Agent task done: “Shop audit”", cite: "task:t1", score: 3 },
  { kind: "win", text: "Finished goal “Pet sim v2”", cite: "goal:g1", score: 100 },
  { kind: "done", text: "Habit streak: gym, 5 days" },
  { kind: "done", text: "2 memories saved" },
  { kind: "late", text: "Goal “Thumbnail pack” missed its deadline Fri 23 Oct", cite: "goal:g2" },
  { kind: "slipped", text: "Agent task failed: “Render”" },
] };

test("summary: wins first, no LIFE data, waiting = approvals then late, a kept lesson as the pattern", () => {
  const x = reviewSummary(week, ["the clip “Hook test”"], "Your Shorts do better posted before noon.");
  assert.deepEqual(x.done, ["Finished goal Pet sim v2", "Agent task done: Shop audit"]);
  assert.deepEqual(x.waiting, ["the clip Hook test", "Goal Thumbnail pack missed its deadline Fri 23 Oct"].map((s) => s.replace("Hook test", "“Hook test”")));
  assert.equal(x.noticed, "Your Shorts do better posted before noon");
  assert.equal(reviewSummary({ ...week, facts: [] }, [], null).noticed, null);
  const o = reviewOpener(x, 19);
  assert.match(o, /^Evening\. It's your weekly review/);
  assert.equal(cleanOpener(o, "base"), o); // fit to say aloud as is
  assert.equal(reviewWeeksAgo(at(9, 0, 26)), 1); // Monday morning: the week that just ended
  assert.equal(reviewWeeksAgo(at(19)), 0);
});

const x: ReviewSummary = { done: ["Finished goal Pet sim v2"], waiting: ["the clip Hook test"], noticed: "you post more on weekends" };

test("the call walks the agenda: done → waiting → noticed → priorities", () => {
  let r = reviewTurn(REVIEW_START, "No, that's it.", x, 0)!;
  assert.equal(r.flow.step, "waiting"); assert.match(r.say!, /^Still waiting: the clip Hook test\. Approvals stay in the app/);
  r = reviewTurn(r.flow, "why did the render fail?", x, 0)!; // off agenda: CORE answers, the step stays
  assert.deepEqual([r.core, r.flow.step], [true, "waiting"]);
  r = reviewTurn(r.flow, "okay", x, 0)!;
  assert.equal(r.flow.step, "noticed"); assert.match(r.say!, /^One thing I noticed: you post more on weekends\./);
  r = reviewTurn(r.flow, "yeah sounds right", x, 0)!;
  assert.deepEqual([r.flow.step, r.say], ["priorities", ASK_PRIORITIES]);
  // nothing waiting and nothing noticed: straight to the ask
  const bare = reviewTurn(REVIEW_START, "nope", { done: [], waiting: [], noticed: null }, 0)!;
  assert.deepEqual([bare.flow.step, bare.say], ["priorities", `Nothing's waiting on you right now. ${ASK_PRIORITIES}`]);
  // he keeps talking off agenda: after two answers ORBIT moves on itself
  let f = REVIEW_START;
  for (const s of ["tell me about the shop audit", "and what did it find"]) f = reviewTurn(f, s, x, 0)!.flow;
  assert.match(reviewTurn(f, "interesting stuff", x, 0)!.say!, /^Let's keep going\. Still waiting/);
});

test("priorities are saved only after the read-back and a fresh yes", () => {
  const p = { ...REVIEW_START, step: "priorities" as const };
  let r = reviewTurn(p, "First, finish the pet sim shop. Second, record a YouTube video. Third, study for the architecture exam.", x, 1000)!;
  assert.equal(r.flow.step, "confirm");
  assert.deepEqual(r.flow.priorities, ["Finish the pet sim shop", "Record a YouTube video", "Study for the architecture exam"]);
  assert.equal(r.say, readBack(r.flow.priorities));
  assert.equal(r.save, undefined);
  const yes = reviewTurn(r.flow, "Yes, save them.", x, 2000)!;
  assert.deepEqual([yes.save, yes.flow.step], [r.flow.priorities, "over"]);
  assert.equal(reviewTurn(yes.flow, "anything", x, 0), null); // the review is over: normal call
  const late = reviewTurn(r.flow, "yes", x, 1000 + CALL.confirmMs + 1)!;
  assert.deepEqual([late.save, late.flow.step], [undefined, "priorities"]);
  const no = reviewTurn(r.flow, "no wait, change the second one", x, 2000)!;
  assert.deepEqual([no.save, no.flow.step], [undefined, "priorities"]);
  const redo = reviewTurn(r.flow, "Actually: gym, Shorts and the shop", x, 2000)!;
  assert.deepEqual([redo.save, redo.flow.step, redo.flow.priorities], [undefined, "confirm", ["Actually: gym", "Shorts", "The shop"]]);
  const skip = reviewTurn(p, "skip for now", x, 0)!;
  assert.deepEqual([skip.save, skip.flow.step], [undefined, "over"]);
  const huh = reviewTurn(p, "hmm", x, 0)!;
  assert.deepEqual([huh.flow.step, huh.flow.tries], ["priorities", 1]);
  assert.equal(reviewTurn(huh.flow, "uh", x, 0)!.flow.step, "over");
});

test("parsePriorities: ordinals, commas, the last 'and', fillers", () => {
  assert.deepEqual(parsePriorities("My top three priorities are: ship the shop update, film two Shorts and email Mart."), ["Ship the shop update", "Film two Shorts", "Email Mart"]);
  assert.deepEqual(parsePriorities("Um, I want to finish the trading system and then record a video"), ["Finish the trading system", "Record a video"]);
  assert.deepEqual(parsePriorities("1. gym 2. study 3. pet sim launch"), ["Gym", "Study", "Pet sim launch"]);
  assert.deepEqual(parsePriorities("a, b, c, d, e, f"), []);
  assert.deepEqual(parsePriorities("one, two, three, four"), ["One", "Two", "Three"]);
});

test("goal body, missed-call brief line", () => {
  const g = priorityGoal("Ship the shop", new Date(2026, 9, 25, 19)); // Sunday evening → next week
  assert.equal(g.deadline, "2026-11-01");
  assert.match(g.why, /week of 2026-10-26/);
  assert.equal(priorityGoal("x", new Date(2026, 9, 23, 19)).deadline, "2026-11-01"); // Friday review: still next week
  assert.match(missedReviewLine(x), /^You missed my weekly review call\. Short version: you got done finished goal Pet sim v2, and one thing is waiting\./);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  assert.equal(missedReviewDue(Date.parse("2026-10-25T17:00:00Z"), "2026-10-26", day), true);
  assert.equal(missedReviewDue(Date.parse("2026-10-25T17:00:00Z"), "2026-10-25", day), false);
  assert.equal(missedReviewDue(Date.parse("2026-10-25T17:00:00Z"), "2026-10-29", day), false);
  assert.equal(missedReviewDue(undefined, "2026-10-26", day), false);
});
