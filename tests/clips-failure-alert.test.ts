import { test } from "node:test";
import assert from "node:assert/strict";
import { alertingGroups, alertSnapshot, failureGroups, failKey, parseAck } from "../src/lib/clips/failure-alert-pure.ts";
import { clipProblemNotices } from "../src/lib/interruption-pure.ts";

const SRC = "IShowSpeed Speed Vs. Cole Palmer.mp4";
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T12:00:00.000Z`;
const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const empty = { acked: [], shown: {} };
// Observed live: seven interrupted downloads of one source, one interrupted-twice job, one non-English skip.
const live = {
  downloads: [17, 18, 19, 20, 21, 22, 23].map((d) => ({ id: `dl${d}`, status: "failed", url: "https://youtu.be/x", file: `C:\\inbox\\${SRC}`, error: "interrupted — start again", createdAt: day(d) })),
  jobs: [
    { id: "j1", status: "failed", source: SRC, error: "interrupted twice: ORBIT restarted during this job again", updatedAt: day(24) },
    { id: "j2", status: "failed", source: "other.mp4", error: "Skipped: the speech isn't English (Whisper heard es).", updatedAt: day(26) },
  ],
};

test("repeated failures of one source are one group ×N; downloads and the job for the same file count once; skips don't count", () => {
  const g = failureGroups(live, empty);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 8);
  assert.equal(g[0].job?.id, "j1");
  const notices = clipProblemNotices(alertSnapshot(live, g));
  assert.deepEqual(notices.map((n) => n.title), ["A clip job failed"]);
});

test("a later finished job for the same source clears the failures", () => {
  const data = { ...live, jobs: [...live.jobs, { id: "j3", status: "done", source: SRC, updatedAt: day(27) }] };
  assert.equal(failureGroups(data, empty).length, 0);
  const earlier = { ...live, jobs: [...live.jobs, { id: "j0", status: "done", source: SRC, updatedAt: day(10) }] };
  assert.equal(failureGroups(earlier, empty).length, 1); // finished before the failures: still failing
});

test("old failures alert once, then stay quiet; a new failure of the source alerts again", () => {
  const first = alertingGroups(live, empty, NOW);
  assert.equal(first.groups.length, 1);
  assert.equal(alertingGroups(live, { acked: [], shown: first.shown }, NOW + 60_000).groups.length, 0);
  const fresh = { ...live, jobs: [...live.jobs, { id: "j9", status: "failed", source: SRC, error: "boom", updatedAt: "2026-10-30T11:00:00.000Z" }] };
  const again = alertingGroups(fresh, { acked: [], shown: first.shown }, NOW);
  assert.equal(again.groups.length, 1);
  assert.equal(again.groups[0].count, 9);
  // recent failures keep alerting while open
  assert.equal(alertingGroups(fresh, { acked: [], shown: again.shown }, NOW).groups.length, 1);
});

test("dismiss acknowledges every failure in the group", () => {
  const g = failureGroups(live, empty)[0];
  assert.equal(failureGroups(live, { acked: g.keys, shown: {} }).length, 0);
  assert.equal(failKey({ id: "a", updatedAt: "t" }), "a:t");
  assert.deepEqual(parseAck("junk"), empty);
});
