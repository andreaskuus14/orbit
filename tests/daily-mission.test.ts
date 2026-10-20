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
