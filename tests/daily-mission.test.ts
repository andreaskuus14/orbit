import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyMission, missionLine } from "../src/lib/daily-mission-pure.ts";

test("daily mission ticks off from real counts and says only what's left", () => {
  const m = dailyMission({ shortsToday: 1, contactedToday: 0, approvalsWaiting: 4 });
  assert.equal(m.done, 0);
  assert.deepEqual(m.items.map((i) => i.progress), ["1/2", "0/1", "4 waiting"]);
  assert.equal(missionLine(m), "Today's mission: post 2 shorts, contact 1 business, clear your approvals.");
  const all = dailyMission({ shortsToday: 3, contactedToday: 2, approvalsWaiting: 0 });
  assert.equal(all.done, 3);
  assert.equal(all.items[0].progress, "2/2");
  assert.equal(missionLine(all), "Today's mission is complete.");
});

test("his picks: counted from records, a missing source is 'no data' and never done", async () => {
  const { parsePicks, followupsSent } = await import("../src/lib/daily-mission-pure.ts");
  const picks = parsePicks([{ id: "invoices", n: 1 }, { id: "study", n: 20 }, { id: "approvals" }, { id: "devsession" }]);
  assert.ok(Array.isArray(picks));
  const m = dailyMission({ invoicesToday: 1, studyToday: 5, approvalsWaiting: 0 }, picks);
  assert.deepEqual(m.items.map((i) => [i.id, i.done, i.progress]), [["invoices", true, "1/1"], ["study", false, "5/20"], ["approvals", true, "none waiting"], ["devsession", false, "no data"]]);
  assert.equal(m.items[3].noData, true);
  assert.equal(missionLine(m), "Today's mission: review 20 study cards, do 1 game dev session.");
  assert.deepEqual(dailyMission({ shortsToday: 2, contactedToday: 1, approvalsWaiting: 0 }, []).items.map((i) => i.id), ["shorts", "contact", "approvals"]); // nothing picked = the original three
  assert.equal(typeof parsePicks(new Array(6).fill(0).map((_, k) => ({ id: ["shorts", "contact", "approvals", "followups", "invoices", "study"][k] }))), "string");
  assert.equal(typeof parsePicks([{ id: "shorts" }, { id: "shorts" }]), "string");
  assert.equal(typeof parsePicks([{ id: "toString" }]), "string");
  assert.equal(typeof parsePicks([{ id: "study", n: 0 }]), "string");
  const from = Date.parse("2026-11-20T00:00:00Z");
  assert.equal(followupsSent([[{ at: "2026-11-10T00:00:00Z", kind: "sent" }, { at: "2026-11-20T08:00:00Z", kind: "sent" }], [{ at: "2026-11-20T09:00:00Z", kind: "sent" }], [{ at: "2026-11-20T09:00:00Z", kind: "note" }]], from), 1); // a first message is not a follow-up
});
