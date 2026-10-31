import { test } from "node:test";
import assert from "node:assert/strict";
import { alertingGroups, alertSnapshot, failureGroups, failKey, legacyAcked } from "../src/lib/clips/failure-alert-pure.ts";
import { clipProblemNotices } from "../src/lib/interruption-pure.ts";

const SRC = "IShowSpeed Speed Vs. Cole Palmer.mp4";
const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}T12:00:00.000Z`;
const NOW = Date.parse("2026-10-31T10:00:00.000Z");
const empty: string[] = [];
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

test("failures older than 72 h never alert (any browser); a fresh one does; both stay in the Failed list", () => {
  // Live 2026-10-31: interrupted downloads, a 403, an interrupted-twice job and a non-English skip, all dated 10-17..26.
  const old = { ...live, downloads: [...live.downloads,
    { id: "dl403", status: "failed", url: "https://www.youtube.com/watch?v=abcdefghijk", error: "HTTP Error 403: Forbidden", createdAt: day(25) }] };
  assert.equal(alertingGroups(old, empty, NOW).length, 0);
  assert.deepEqual(clipProblemNotices(alertSnapshot(old, alertingGroups(old, empty, NOW))), []);
  assert.equal(failureGroups(old, empty).length, 2); // still listed with Retry/Dismiss
  const fresh = { ...old, jobs: [...old.jobs, { id: "j9", status: "failed", source: SRC, error: "boom", updatedAt: "2026-10-31T08:00:00.000Z" }] };
  const g = alertingGroups(fresh, empty, NOW);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 1); // only the fresh failure counts toward the alert
  assert.deepEqual(clipProblemNotices(alertSnapshot(fresh, g)).map((n) => n.title), ["A clip job failed"]);
  assert.equal(alertingGroups(fresh, g[0].keys, NOW).length, 0); // dismissed (server-side list)
});

test("a failed download is resolved by a later finished download of the same video, whatever the link form", () => {
  const data = { downloads: [
    { id: "a", status: "failed", url: "https://www.youtube.com/watch?v=abcdefghijk", error: "interrupted — start again", createdAt: "2026-10-31T08:00:00.000Z" },
    { id: "b", status: "done", url: "https://youtu.be/abcdefghijk", file: "Some - Video [abcdefghijk].mp4", createdAt: "2026-10-31T09:00:00.000Z" }],
    jobs: [{ id: "j", status: "done", source: "Some - Video [abcdefghijk].mp4", updatedAt: "2026-10-31T09:30:00.000Z" }] };
  assert.equal(alertingGroups(data, empty, NOW).length, 0);
  assert.equal(alertingGroups({ downloads: [data.downloads[0]] }, empty, NOW).length, 1);
});

test("dismiss acknowledges every failure in the group; old browser dismissals are read once", () => {
  const g = failureGroups(live, empty)[0];
  assert.equal(failureGroups(live, g.keys).length, 0);
  assert.equal(failKey({ id: "a", updatedAt: "t" }), "a:t");
  assert.deepEqual(legacyAcked("junk"), []);
  assert.deepEqual(legacyAcked(JSON.stringify({ acked: ["x:1", 3], shown: {} })), ["x:1"]);
});
