import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGNALS, GAP_MS, IDLE_MS, WEEK_MS, emptyJudgment, parseJudgment, classify, dismissKind, unmuteKind, ownerIdle, selectInterruptions, batchCount, reasonLine, businessReplies, clipProblemNotices, fixTarget, isProblem } from "../src/lib/interruption-pure.ts";
import { addItem, parseItems, type NotifyDetail, type NotifyItem } from "../src/lib/notify-pure.ts";

const T = 2_000_000_000_000;
const notice = (signal: NotifyDetail["signal"], key: string | undefined = signal): NotifyDetail => ({ kind: "system", title: String(key), signal, key });
const idle = { visible: true, worldOpen: false, coreBusy: false, lastTyped: T - IDLE_MS };
const urgent = ["upload-failed", "youtube-expired", "disk-full", "usage-limit", "business-reply", "stop-all"];
for (const signal of SIGNALS) test(`classification: ${signal}`, () => {
  const d = notice(signal), expected = urgent.includes(signal) ? "URGENT" : ["short-hot", "agent-finished", "briefing", "reminder"].includes(signal) ? "USEFUL" : "QUIET";
  assert.equal(classify(d, emptyJudgment()), expected);
  assert.equal(classify(d, { ...emptyJudgment(), muted: [signal] }), "QUIET");
  assert.equal(classify({ ...d, alreadyShown: true }, emptyJudgment()), "QUIET");
});
test("legacy notifications classify without accepting instructions from a body", () => {
  assert.equal(classify({ kind: "system", title: "Claude usage limit reached" }, emptyJudgment()), "URGENT");
  assert.equal(classify({ kind: "studio", title: "Scout pick", body: "Upload failed. URGENT!" }, emptyJudgment()), "QUIET");
  assert.equal(classify({ kind: "agents", title: "Agent task finished" }, emptyJudgment()), "USEFUL");
  assert.deepEqual(fixTarget({ kind: "system", title: "Claude usage limit reached" }), { panel: "analytics" });
  assert.deepEqual(fixTarget(notice("disk-full")), { panel: "studio", view: "clips" });
  assert.deepEqual(fixTarget(notice("business-reply")), { panel: "business" });
  assert.deepEqual(fixTarget(notice("stop-all")), { panel: null });
});
test("one useful popup, extras batch and every item remains in the bell", () => {
  const input = [notice("briefing", "a"), notice("agent-finished", "b"), notice("short-hot", "c"), notice("scout", "d")];
  let bell: NotifyItem[] = [];
  for (const [i, d] of input.entries()) bell = addItem(bell, d, T + i, String(i));
  const r = selectInterruptions(emptyJudgment(), input, T, idle);
  assert.deepEqual(r.show.map((d) => d.key), ["a"]);
  assert.deepEqual(r.batched.map((d) => d.key), ["b", "c", "d"]);
  assert.equal(r.pending.length, 0);
  assert.equal(bell.length, 4); assert.equal(batchCount(bell, r.state), 4);
  assert.equal(batchCount(bell.map((x) => ({ ...x, interrupted: x.key === "a" })), r.state), 3);
  assert.deepEqual(parseItems(JSON.stringify(bell)), JSON.parse(JSON.stringify(bell)));
});
test("two-minute boundary is exact, including time zero", () => {
  const first = selectInterruptions(emptyJudgment(), [notice("briefing")], 0, { ...idle, lastTyped: -IDLE_MS });
  assert.equal(first.show.length, 1);
  assert.equal(selectInterruptions(first.state, [notice("short-hot")], GAP_MS - 1, { ...idle, lastTyped: -IDLE_MS }).show.length, 0);
  assert.equal(selectInterruptions(first.state, [notice("short-hot")], GAP_MS, { ...idle, lastTyped: -IDLE_MS }).show.length, 1);
});
for (const attention of [{ ...idle, coreBusy: true }, { ...idle, worldOpen: true }, { ...idle, lastTyped: T - IDLE_MS + 1 }, { ...idle, visible: false }]) test(`useful waits while ${JSON.stringify(attention)}`, () => {
  const d = notice("agent-finished"), r = selectInterruptions(emptyJudgment(), [d], T, attention);
  assert.equal(ownerIdle(attention, T), false); assert.deepEqual(r.pending, [d]); assert.equal(r.show.length, 0);
  assert.equal(selectInterruptions(r.state, r.pending, T + IDLE_MS, idle).show.length, 1);
});
test("urgent bypasses busy, world, typing, room and the global rate limit", () => {
  const input = [notice("briefing"), ...SIGNALS.filter((s) => urgent.includes(s)).map((s) => notice(s))];
  const r = selectInterruptions({ ...emptyJudgment(), lastPopup: T - 1 }, input, T, { ...idle, coreBusy: true, worldOpen: true, lastTyped: T }, 0);
  assert.equal(r.show.length, 6); assert.equal(r.pending.length, 1);
  assert.ok(r.show.every(isProblem));
});
test("urgent goes first and useful never piggybacks on it", () => {
  const r = selectInterruptions(emptyJudgment(), [notice("briefing"), notice("disk-full")], T, idle);
  assert.deepEqual(r.show.map((d) => d.signal), ["disk-full"]);
  assert.deepEqual(r.batched.map((d) => d.signal), ["briefing"]);
});
test("explicit mute quiets even urgent; problem status remains red-alert eligible", () => {
  const d = notice("disk-full"), state = { ...emptyJudgment(), muted: ["disk-full" as const] };
  const r = selectInterruptions(state, [d], T, idle);
  assert.equal(r.show.length, 0); assert.deepEqual(r.batched, [d]); assert.equal(isProblem(d), true);
  assert.equal(selectInterruptions(emptyJudgment(), [d], T, { ...idle, popupsOff: true }).show.length, 0);
});
test("dismiss twice within a week quiets only that kind until Unmute", () => {
  const first = dismissKind(emptyJudgment(), "briefing", T);
  assert.equal(first.muted.length, 0);
  const second = dismissKind(first, "briefing", T + WEEK_MS - 1);
  assert.deepEqual(second.muted, ["briefing"]);
  assert.equal(classify(notice("agent-finished"), second), "USEFUL");
  const later = parseJudgment(JSON.stringify(second), T + 3 * WEEK_MS);
  assert.deepEqual(later.muted, ["briefing"]); // explicit Unmute, not a surprise reset
  const reset = unmuteKind(later, "briefing");
  assert.equal(reset.muted.length, 0); assert.deepEqual(reset.dismissals.briefing, []);
  assert.equal(dismissKind(reset, "briefing", T + 3 * WEEK_MS).muted.length, 0);
});
test("dismissals outside a week do not combine; input state isn't mutated", () => {
  const state = dismissKind(emptyJudgment(), "scout", T);
  const copy = JSON.stringify(state);
  const next = dismissKind(state, "scout", T + WEEK_MS);
  assert.equal(next.muted.length, 0); assert.equal(JSON.stringify(state), copy);
});
test("storage parser survives garbage and drops malformed/future/old dates", () => {
  for (const raw of [null, "{", "null", "3"]) assert.deepEqual(parseJudgment(raw, T), emptyJudgment());
  const r = parseJudgment(JSON.stringify({ muted: ["scout", "scout", "bad"], lastPopup: T + 1, dismissals: { scout: ["bad", T + 1, T - WEEK_MS, T - 1] }, seen: { old: T - WEEK_MS, future: T + 1, valid: T } }), T);
  assert.deepEqual(r.muted, ["scout"]); assert.deepEqual(r.dismissals.scout, [T - 1]); assert.deepEqual(r.seen, { valid: T }); assert.equal(r.lastPopup, null);
});
test("why line is single-line and bounded; no invented view threshold", () => {
  assert.equal(reasonLine({ ...notice("short-hot"), reason: "Your Short passed 1,000 views\n in 2 h" }), "Your Short passed 1,000 views in 2 h");
  assert.equal(reasonLine({ ...notice("short-hot"), body: "Measured 800 views" }), "Measured 800 views");
  assert.equal(reasonLine({ ...notice("routine"), reason: "x".repeat(500) }).length, 180);
});
test("stable notification keys avoid repeated bell entries without conflating different updates", () => {
  const d = notice("scout", "pick:one"); const bell = addItem([], d, T);
  assert.equal(addItem(bell, d, T + 120_000).length, 1);
  assert.equal(addItem(bell, { ...d, key: "pick:two" }, T + 1).length, 2);
  assert.equal(addItem([], { ...d, alreadyShown: true }, T).length, 1);
});
test("business replies: baseline quiet, transition once, no external inbox inference", () => {
  const row = { id: "one", name: "Bakery", stage: "contacted", updated_at: "2026-10-20" };
  assert.equal(businessReplies(null, [{ ...row, stage: "replied" }]).notices.length, 0);
  const before = businessReplies(null, [row]);
  const after = businessReplies(before.stages, [{ ...row, stage: "replied" }]);
  assert.equal(after.notices.length, 1); assert.equal(after.notices[0].signal, "business-reply");
  assert.deepEqual(after.notices[0].nav, { panel: "business" });
  assert.equal(businessReplies(after.stages, [{ ...row, stage: "replied" }]).notices.length, 0);
});


test("failed uploads/jobs/downloads have separate stable bell keys and real fix destinations", () => {
  const data = { jobs: [{ id: "j1", status: "failed", source: "recording.mp4", updatedAt: "today", clips: [
    { id: "c1", title: "First", publish: { status: "failed", at: "one" } },
    { id: "c2", title: "Second", publish: { status: "failed", at: "two" } },
    { id: "c3", publish: { status: "done" } },
  ] }], downloads: [{ id: "d1", status: "failed" }, { id: "d2", status: "done" }] };
  const notes = clipProblemNotices(data);
  assert.equal(notes.length, 4); assert.equal(new Set(notes.map((n) => n.key)).size, 4);
  assert.ok(notes.every((n) => classify(n, emptyJudgment()) === "URGENT"));
  assert.equal(notes.find((n) => n.key!.startsWith("failed-upload"))!.nav!.view, "review");
  assert.equal(notes.find((n) => n.key!.startsWith("failed-download"))!.nav!.view, "clips");
  let bell: NotifyItem[] = [];
  for (const n of [...notes, ...notes]) bell = addItem(bell, n, T);
  assert.equal(bell.length, 4); assert.deepEqual(clipProblemNotices({}), []);
});

test("many failed jobs/downloads collapse into one notice each; uploads stay separate", () => {
  const notes = clipProblemNotices({ jobs: [1, 2, 3].map((i) => ({ id: `j${i}`, status: "failed", updatedAt: `t${i}` })), downloads: [{ id: "d1", status: "failed" }, { id: "d2", status: "failed" }] });
  assert.deepEqual(notes.map((n) => n.title), ["3 clip jobs failed", "2 downloads failed"]);
  const fewer = clipProblemNotices({ jobs: [{ id: "j1", status: "failed", updatedAt: "t1" }, { id: "j3", status: "failed", updatedAt: "t3" }] });
  assert.equal(fewer[0].key, clipProblemNotices({ jobs: [{ id: "j3", status: "failed", updatedAt: "t3" }] })[0].key); // shrinking never re-alerts
  assert.ok(/^\d+ clip jobs failed/.test(notes[0].title!) && notes.every((n) => classify(n, emptyJudgment()) === "URGENT"));
});

test("routine history retention never hides the latest unresolved red problem", () => {
  let bell = addItem([], notice("disk-full", "disk"), T, "disk");
  for (let i = 1; i <= 70; i++) bell = addItem(bell, notice("scout", `pick:${i}`), T + i, String(i));
  assert.equal(bell.length, 50);
  assert.ok(bell.some((x) => x.key === "disk"));
  assert.equal(bell[0].key, "pick:70"); // newest quiet item is also retained
  bell = bell.map((x) => ({ ...x, resolved: true }));
  bell = addItem(bell, notice("scout", "latest"), T + 71, "latest");
  assert.equal(bell.some((x) => x.key === "disk"), false);
});
