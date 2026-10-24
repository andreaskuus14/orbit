// Roadmap 3.1: Higgsfield as a CORE tool behind the approve-to-spend gate, with a weekly credit cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capProblem, draftBlocked, draftItems, validDraft, weeklyCap, weekSpent, weekStart, DEFAULT_WEEKLY_CAP } from "../src/lib/higgsfield-pure.ts";
import { BATCH_TOOL, HF, approveProblem, fingerprint, guardDecision, quoteTotal, type StoryJob } from "../src/lib/clips/story-pure.ts";
import { decide, policyEvent, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { ledgerIssue } from "../src/lib/ledger-pure.ts";

const m = { image: "img_m", video: "vid_m" };
const ctx = (o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: "make 2 images of a fox in the snow", ...o });
const step = (tool: string) => `You called ${tool} {}\nRESULT:\nok`;

test("validDraft: defaults, limits and model ids", () => {
  assert.deepEqual(validDraft({ prompt: "  a fox \n in snow " }, m), { kind: "image", prompt: "a fox in snow", model: "img_m", count: 1, aspect: "9:16" });
  assert.deepEqual(validDraft({ prompt: "a fox", kind: "video", count: 2, aspect: "16:9", model: "kling-2.1" }, m), { kind: "video", prompt: "a fox", model: "kling-2.1", count: 2, aspect: "16:9" });
  assert.match(String(validDraft({ prompt: "ab" }, m)), /prompt/);
  assert.match(String(validDraft({ prompt: "a fox", count: 5 }, m)), /count/);
  assert.match(String(validDraft({ prompt: "a fox", count: 1.5 }, m)), /count/);
  assert.match(String(validDraft({ prompt: "a fox", kind: "audio" }, m)), /kind/);
  assert.match(String(validDraft({ prompt: "a fox", aspect: "2:1" }, m)), /aspect/);
  assert.match(String(validDraft({ prompt: "a fox", model: "x; rm -rf" }, m)), /model/);
  assert.match(String(validDraft(null, m)), /object/);
});

test("draftItems: one paid item per generation, credits only (use_unlim false), and the guard allows only quotes before approval", () => {
  const d = validDraft({ prompt: "a fox", count: 3 }, m);
  assert.ok(typeof d !== "string");
  const items = draftItems(d);
  assert.deepEqual(items.map((i) => [i.key, i.index]), [["image-0", 0], ["image-1", 1], ["image-2", 2]]);
  assert.equal(items[0].params.use_unlim, false);
  assert.equal(draftItems({ ...d, kind: "video", count: 1 })[0].params.duration, 5);
  // quote mode: price checks only; a real generate call (no get_cost) and a batch submit are blocked
  assert.equal(guardDecision({ mode: "quote" }, [], HF + "generate_image", { params: { ...items[0].params, get_cost: true } }).allow, true);
  assert.equal(guardDecision({ mode: "quote" }, [], HF + "generate_image", { params: items[0].params }).allow, false);
  assert.equal(guardDecision({ mode: "quote" }, [], BATCH_TOOL.image, { requests: [] }).allow, false);
  // submit mode: exactly the approved batch, once
  const allow = [{ tool: BATCH_TOOL.image, requests: items.map((i) => ({ index: i.index, params: i.params })) }];
  assert.equal(guardDecision({ mode: "submit", allow }, [], BATCH_TOOL.image, { requests: allow[0].requests }).allow, true);
  assert.equal(guardDecision({ mode: "submit", allow }, [0], BATCH_TOOL.image, { requests: allow[0].requests }).allow, false);
  assert.equal(guardDecision({ mode: "submit", allow }, [], BATCH_TOOL.image, { requests: [...allow[0].requests, { index: 3, params: items[0].params }] }).allow, false);
});

test("a draft job uses the AI Story approve gate unchanged: no spend without the exact quoted click", () => {
  const d = validDraft({ prompt: "a fox", count: 2 }, m) as Exclude<ReturnType<typeof validDraft>, string>;
  const job: StoryJob = { v: 1, id: "x", createdAt: "", updatedAt: "", status: "draft", step: "", opts: { idea: "a fox", style: "", length: 0, voice: "none", motion: "stills" },
    story: { title: "CORE: 2× image, a fox", hook: "", scenes: [] }, items: draftItems(d), warnings: [], draft: d };
  assert.match(approveProblem(job, 0), /cost first/); // CORE drafted it, nobody quoted: nothing to approve
  job.items.forEach((i) => (i.credits = 2));
  job.quote = { total: 4, balance: 50, plan: "p", fingerprint: fingerprint(job.story, job.opts), at: "" };
  assert.equal(quoteTotal(job.items), 4);
  assert.match(approveProblem(job, 3), /quoted total/);
  assert.equal(approveProblem(job, 4), "");
});

test("draftBlocked: the user's own imperative, first tool, never a question or a negation", () => {
  for (const q of ["make 2 images of a fox in the snow", "generate a video of waves at night", "draft a higgsfield picture of a castle", "please create 3 wallpapers of mars"]) assert.equal(draftBlocked(q, false), "", q);
  for (const q of ["can you tell me how many images I made?", "what did higgsfield make?", "make me a sandwich", "don't generate an image yet", "hello", "make 2 images of a fox?"]) assert.notEqual(draftBlocked(q, false), "", q);
  assert.match(draftBlocked("make 2 images of a fox", true), /first tool/);
});

test("weekStart: Monday 00:00 Europe/Tallinn, across the October DST change", () => {
  const iso = (t: number) => new Date(t).toISOString();
  assert.equal(iso(weekStart(Date.parse("2026-10-24T12:00:00Z"))), "2026-10-18T21:00:00.000Z"); // Sat → Mon 19 Oct 00:00 EEST (+3)
  assert.equal(iso(weekStart(Date.parse("2026-10-18T21:00:00Z"))), "2026-10-18T21:00:00.000Z"); // exactly Monday 00:00
  assert.equal(iso(weekStart(Date.parse("2026-10-18T20:59:59Z"))), "2026-10-11T21:00:00.000Z"); // Sunday 23:59:59 local: last week
  assert.equal(iso(weekStart(Date.parse("2026-10-25T23:30:00Z"))), "2026-10-25T22:00:00.000Z"); // after DST ends: Mon 26 Oct 00:00 EET (+2)
  assert.equal(iso(weekStart(Date.parse("2026-10-25T12:00:00Z"))), "2026-10-18T21:00:00.000Z"); // Sun after DST ended (+2): Monday was still +3
  assert.equal(iso(weekStart(Date.parse("2026-03-29T12:00:00Z"))), "2026-03-22T22:00:00.000Z"); // Sun after DST started (+3): Monday was +2
});

test("weekSpent, weeklyCap and capProblem", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.equal(weekSpent([{ at: "2026-10-18T20:59:00Z", credits: 50 }, { at: "2026-10-19T08:00:00Z", credits: 2.5 }, { at: "2026-10-24T11:00:00Z", credits: 4 }, { at: "2026-10-25T00:00:00Z", credits: 9 }], now), 6.5);
  assert.equal(weeklyCap(undefined), DEFAULT_WEEKLY_CAP);
  assert.equal(weeklyCap(""), DEFAULT_WEEKLY_CAP);
  assert.equal(weeklyCap("abc"), DEFAULT_WEEKLY_CAP);
  assert.equal(weeklyCap("-1"), DEFAULT_WEEKLY_CAP);
  assert.equal(weeklyCap("0"), 0);
  assert.equal(weeklyCap("25"), 25);
  assert.equal(capProblem(6, 4, 10), ""); // exactly the cap
  assert.match(capProblem(6.5, 4, 10), /weekly Higgsfield cap: 6.5 of 10/);
  assert.match(capProblem(0, 1, 0), /cap/); // cap 0 blocks all spending
  assert.equal(capProblem(50, 0, 10), ""); // resuming paid jobs costs nothing new
});

test("policy: higgsfield_draft is T3 with an owner-click approval path; refused unless asked, first tool, clean context, Stop-all off", () => {
  const rows: [Partial<PolicyCtx>, boolean, RegExp?][] = [
    [{}, true],
    [{ question: "what can higgsfield make?" }, false, /latest message/],
    [{ steps: [step("fetch_url")] }, false, /first tool/],
    [{ attach: true }, false, /first tool/],
    [{ pins: true }, false, /first tool/],
    [{ steps: [step("navigate")] }, true],
    [{ stopAll: true }, false, /Stop-all/],
  ];
  for (const [c, allow, reason] of rows) {
    const d = decide("higgsfield_draft", { prompt: "a fox" }, ctx(c));
    assert.equal(d.tier, "T3");
    assert.equal(d.allow, allow, JSON.stringify(c));
    if (reason) assert.match(d.reason, reason);
  }
  const ev = policyEvent("higgsfield_draft", decide("higgsfield_draft", { prompt: "SECRET" }, ctx()))!;
  assert.deepEqual(ev, { tool: "higgsfield_draft", tier: "T3", verdict: "allow", reason: "allowed" });
});

test("ledger: higgsfield.spend events", () => {
  assert.equal(ledgerIssue("higgsfield.spend", "studio", { jobId: "abc-123456", credits: 4.5, kind: "draft" }), null);
  assert.equal(ledgerIssue("higgsfield.spend", "studio", { jobId: "abc-123456", credits: 12, kind: "story" }), null);
  assert.match(String(ledgerIssue("higgsfield.spend", "studio", { jobId: "abc", credits: 0, kind: "draft" })), /credits/);
  assert.match(String(ledgerIssue("higgsfield.spend", "studio", { jobId: "abc", credits: 2, kind: "tweet" })), /kind/);
});
