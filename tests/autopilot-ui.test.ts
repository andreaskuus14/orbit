import { test } from "node:test";
import assert from "node:assert/strict";
import { avatar, badge, multBars, nextAction, nextScout, type NextIn } from "../src/lib/clips/autopilot-ui.ts";
import { editProposal, parseAutopilot, emptyAutopilot, type Autopilot, type Proposal } from "../src/lib/clips/autopilot-pure.ts";

test("multBars: order per dimension, widths relative to max (≥ 1.5×), 1× marker, badges, junk dropped", () => {
  const c = multBars("creator", { A: { n: 3, mult: 1.2 }, B: { n: 20, mult: 2 }, C: { n: 1, mult: 0.5 }, D: { n: 0, mult: 9 }, E: { n: 2, mult: NaN } });
  assert.deepEqual(c.bars.map((b) => b.label), ["B", "C", "A"]); // strongest effect first (|log|): 2× > 0.5× > 1.2×
  assert.equal(c.bars[0].width, 100);
  assert.equal(c.one, 50);
  assert.deepEqual(c.bars.map((b) => b.badge), ["solid", "guess", "weak"]);
  assert.deepEqual(multBars("length", { "40+": { n: 2, mult: 1 }, "<20": { n: 2, mult: 1 }, "20-30": { n: 2, mult: 1 } }).bars.map((b) => b.label), ["<20", "20-30", "40+"]);
  const h = multBars("hour", { "18:00": { n: 5, mult: 1.1 }, "09:00": { n: 5, mult: 0.9 } });
  assert.deepEqual(h.bars.map((b) => b.label), ["09:00", "18:00"]);
  assert.equal(h.one, 66.7); // max 1.1 < 1.5: scaled to 1.5
  assert.deepEqual(multBars("creator", undefined), { bars: [], one: 66.7 });
  assert.equal(multBars("creator", Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, { n: 2, mult: 1 + i / 10 }]))).bars.length, 6);
  assert.equal(badge(4), "weak"); assert.equal(badge(14), "moderate");
});

test("nextScout: today at runAt, now when overdue, tomorrow once it ran today", () => {
  const morning = new Date(2026, 9, 18, 5, 30), noon = new Date(2026, 9, 18, 12, 0);
  assert.equal(nextScout(6, "2026-10-17", morning).getTime(), new Date(2026, 9, 18, 6).getTime());
  assert.equal(nextScout(6, "2026-10-17", noon), noon);
  assert.equal(nextScout(6, "2026-10-18", noon).getTime(), new Date(2026, 9, 19, 6).getTime());
});

test("nextAction: waiting beats work beats setup beats the schedule", () => {
  const now = new Date(2026, 9, 18, 5, 0), fmt = (d: Date) => `${d.getHours()}h`;
  const base: NextIn = { waiting: 0, clipping: 0, packaging: 0, candidates: 0, running: false, configured: true, creators: 2, auto: true, left: 1, runAt: 6, lastScheduled: "2026-10-17" };
  assert.equal(nextAction({ ...base, waiting: 2, running: true }, now, fmt), "2 clips waiting for you");
  assert.equal(nextAction({ ...base, running: true }, now, fmt), "Finding candidates now…");
  assert.equal(nextAction({ ...base, clipping: 1, packaging: 3 }, now, fmt), "Clipping 1 video…");
  assert.match(nextAction({ ...base, packaging: 3 }, now, fmt), /^Packaging 3 clips/);
  assert.match(nextAction({ ...base, configured: false }, now, fmt), /YOUTUBE_API_KEY/);
  assert.match(nextAction({ ...base, creators: 0 }, now, fmt), /Add creators/);
  assert.equal(nextAction({ ...base, candidates: 1 }, now, fmt), "1 candidate ready: clip the best one");
  assert.equal(nextAction(base, now, fmt), "Finding candidates at 6h, then clipping the best");
  assert.equal(nextAction({ ...base, auto: false, left: 0, candidates: 4 }, now, fmt), "Finding candidates at 6h");
  assert.equal(nextAction({ ...base, left: 0, lastScheduled: undefined, runAt: 4 }, now, fmt), "Finding candidates in a few minutes (today's cap is reached)");
});

test("avatar: initials and a stable hue", () => {
  assert.equal(avatar("Kai Cenat").text, "KC");
  assert.equal(avatar("xQc").text, "XQ");
  assert.equal(avatar("").text, "?");
  assert.equal(avatar("Ninja").hue, avatar("Ninja").hue);
  assert.ok(avatar("Ninja").hue >= 0 && avatar("Ninja").hue < 360);
});

const P: Proposal = { title: "Main", titleWhy: "w", slot: "2026-10-20T16:00:00.000Z", slotWhy: "next", at: "t", alts: ["Alt 1", "Alt 2"] };

test("editProposal: swap keeps two runner-ups, slot must be free, bad input refused", () => {
  const sw = editProposal(P, { title: "Alt 2" }, []) as Proposal;
  assert.equal(sw.title, "Alt 2");
  assert.deepEqual(sw.alts, ["Main", "Alt 1"]);
  assert.equal(sw.titleWhy, "You picked this title");
  assert.deepEqual(editProposal(P, { title: "Main" }, []), P); // same title: unchanged
  assert.equal((editProposal(P, { title: "  Main " }, []) as Proposal).titleWhy, "w");
  assert.match(editProposal(P, { title: "" }, []) as string, /title/);
  assert.match(editProposal(P, { title: "x".repeat(101) }, []) as string, /title/);
  const sl = editProposal(P, { slot: "2026-10-21T16:00:00.000Z" }, ["2026-10-21T16:00:00.000Z"]) as Proposal;
  assert.equal(sl.slot, "2026-10-21T16:00:00.000Z");
  assert.equal(sl.slotWhy, "You picked this slot");
  assert.match(editProposal(P, { slot: "2026-10-22T16:00:00.000Z" }, ["2026-10-21T16:00:00.000Z"]) as string, /isn't free/);
  assert.match(editProposal(P, { slot: 5 }, []) as string, /isn't free/);
});

test("parseAutopilot keeps valid alts/notes/video and drops proposals with junk in them", () => {
  const a = emptyAutopilot();
  const p = parseAutopilot({ ...a, proposals: {
    "abcdef-123abc/clip-1": { ...P, notes: ["ok"], video: "clips/x/y.mp4" },
    "abcdef-123abc/clip-2": { ...P, alts: [1] },
    "abcdef-123abc/clip-3": { ...P, notes: "nope" },
  } }) as Autopilot;
  assert.deepEqual(Object.keys(p.proposals), ["abcdef-123abc/clip-1"]);
  assert.deepEqual(p.proposals["abcdef-123abc/clip-1"].notes, ["ok"]);
});
