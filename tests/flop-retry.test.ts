import { test } from "node:test";
import assert from "node:assert/strict";
import { flops24, needs24h, learnDue, emptyLearn, applyStats, retryWinners, lastResults, insights, formatTaste, type LearnRec } from "../src/lib/clips/learn-pure.ts";
import { canRetry, mayReplace, privacyStatus, retryConsent, retryFingerprint, retrySpan } from "../src/lib/clips/flop-retry-pure.ts";
import { weightedCost } from "../src/lib/youtube-quota-pure.ts";
import type { Clip, ClipJob } from "../src/lib/clips/types.ts";
import type { Analysis } from "../src/lib/clips/pure.ts";
const NOW = Date.parse("2026-10-21T12:00:00Z"), H = 3600_000;
export const clip = (id = "clip-1", extra: Partial<Clip> = {}): Clip => ({ id, title: "Original", hook: "Old hook", start: 0, end: 20, reason: "", score: 0.5, status: "approved", video: "clips/job/original.mp4", publish: { status: "done", videoId: "abcdefghijk", title: "Original", privacy: "public", at: "" }, ...extra });
export const job = (clips = [clip()]): ClipJob => ({ id: "abcdef-123456", source: "source.mp4", createdAt: "", updatedAt: "", step: "", warnings: [], progress: 1, status: "done", options: { count: 1, maxSec: 30, captions: true }, clips });
export const analysis = (): Analysis => ({ v: 1, duration: 200, hasAudio: true, spans: [], words: [{ text: "new peak", start: 90, end: 95 }], rms: [], cands: [], moments: [] });
export const rec = (n: number, views: number, extra: Partial<LearnRec> = {}): LearnRec => ({ videoId: `vid${String(n).padStart(8, "0")}`, jobId: "abcdef-123456", clipId: `clip-${n}`, title: `Title ${n}`, hook: `Hook ${n}`, reason: "", layout: "fit", captions: "none", durationSec: 20, sourceChannel: "owner", kind: "other", publishedAt: new Date(NOW - 24 * H).toISOString(), snaps: { "24h": { at: new Date(NOW).toISOString(), views, likes: 0, comments: 0 } }, ...extra });

test("24h flop is strictly below half a positive same-age median; late, missing and tiny cohorts never trigger", () => {
  const rows = [rec(1, 49), rec(2, 50), rec(3, 100), rec(4, 100), rec(5, 300)];
  assert.deepEqual(flops24(rows).map((r) => r.clipId), ["clip-1"]);
  assert.deepEqual(flops24(rows.slice(0, 2)), []);
  assert.deepEqual(flops24([rec(1, 0), rec(2, 0), rec(3, 0)]), []);
  assert.deepEqual(flops24(rows.map((r) => ({ ...r, publishedAt: new Date(NOW - 40 * H).toISOString() }))), []);
  assert.deepEqual(flops24([rec(1, 0, { snaps: {} }), rec(2, 1), rec(3, 100)]), []);
});

test("24h refresh retries every 15min inside a 24–30h capture window, without backfilling later views", () => {
  const r = rec(1, 0, { snaps: {} }), s = { ...emptyLearn(), clips: { [r.videoId]: r }, checkedAt: new Date(NOW - H).toISOString() };
  assert.ok(needs24h(r, NOW)); assert.ok(learnDue(s, NOW));
  assert.equal(learnDue({ ...s, checkedAt: new Date(NOW - 60_000).toISOString() }, NOW), false);
  assert.equal(needs24h(r, NOW - 1), false);
  assert.equal(needs24h(r, NOW + 6 * H + 1), false);
  const st = rec(1, 2).snaps["24h"]!;
  assert.equal(applyStats(r, st, r.publishedAt, NOW + 7 * H).snaps["24h"], undefined);
});

test("one retry only: durable claims, any child, rejected/failed clips and retries of retries are excluded", () => {
  const c = clip(), j = job([c]); assert.ok(canRetry(c, j));
  for (const patch of [{ flopRetry: { at: "claimed" } }, { retryOf: { clipId: "clip-2", videoId: "lmnopqrstuv", title: "Parent" } }, { status: "rejected" as const }, { status: "failed" as const }]) assert.equal(canRetry({ ...c, ...patch }, j), false);
  assert.equal(canRetry(c, job([c, clip("clip-1-v2", { retryOf: { clipId: c.id, videoId: "abcdefghijk", title: "Original" } })])), false);
});

test("retry uses a separate strongest peak with transcript, otherwise keeps the original span", () => {
  const c = clip(), j = job([c]);
  j.hype = { peaks: [{ t: 5, height: 100 }, { t: 95, height: 80 }] } as any;
  const span = retrySpan(c, j, analysis());
  assert.ok(span.start >= c.end && span.end <= 200);
  assert.deepEqual(retrySpan(c, j, { ...analysis(), words: [] }), { start: 0, end: 20 });
});

test("replacement requires explicit consent to this render, the claimed pair and a known upload; restore permanently cancels it", () => {
  const old = clip("clip-1", { flopRetry: { at: "claimed", clipId: "clip-1-v2" } });
  const retry = clip("clip-1-v2", { retryOf: { clipId: old.id, videoId: "abcdefghijk", title: old.title }, publish: { status: "done", videoId: "lmnopqrstuv", at: "", title: "Original" } });
  assert.equal(mayReplace(old, retry), false);
  retry.retryApproved = { at: "approved", fingerprint: retryFingerprint(retry) };
  assert.ok(retryConsent(retry)); assert.ok(mayReplace(old, retry));
  for (const patch of [{ title: "Changed" }, { hook: "Changed" }, { start: 1 }, { video: "changed.mp4" }, { status: "ready" as const }]) assert.equal(retryConsent({ ...retry, ...patch }), false);
  assert.equal(mayReplace({ ...old, flopRetry: { ...old.flopRetry!, restoredAt: "restored" } }, retry), false);
  assert.equal(mayReplace(old, { ...retry, publish: { ...retry.publish!, status: "unknown" } }), false);
});

test("privacy update preserves writable settings and charges 50 units; no read-only status fields leak into PUT", () => {
  assert.deepEqual(privacyStatus({ license: "creativeCommon", embeddable: false, publicStatsViewable: false, selfDeclaredMadeForKids: false, containsSyntheticMedia: true, uploadStatus: "processed", madeForKids: true, publishAt: "old schedule" }, "private"), { license: "creativeCommon", embeddable: false, publicStatsViewable: false, selfDeclaredMadeForKids: false, containsSyntheticMedia: true, privacyStatus: "private" });
  assert.equal(weightedCost("videos.update"), 50);
});

test("taste weights the pair winner twice, comparing only same-age views (including an original that beats its retry)", () => {
  const old = rec(1, 30), retry = rec(2, 100, { retryOf: old.videoId });
  assert.equal(retryWinners([old, retry])[0].videoId, retry.videoId);
  assert.equal(retryWinners([old, retry])[0].weight, 2);
  assert.equal(retryWinners([old, { ...retry, snaps: { "24h": { ...retry.snaps["24h"]!, views: 10 } } }])[0].videoId, old.videoId);
  assert.deepEqual(retryWinners([old, { ...retry, snaps: { "48h": retry.snaps["24h"] } }]), []);
  const i = insights({ ...emptyLearn(), clips: { [old.videoId]: old, [retry.videoId]: retry } }, []);
  assert.match(formatTaste(i), /Retry-pair winners \(weight 2/); assert.match(formatTaste(i), /Title 2/);
});

test("Last Shorts exposes 24h flops and restoration state and keeps older originals reachable", () => {
  const r = rec(1, 0), c = clip(r.clipId, { flopRetry: { at: "", clipId: "clip-1-v2", privateAt: "private" } });
  const rows = [r, ...Array.from({ length: 12 }, (_, n) => rec(n + 2, 100, { publishedAt: new Date(NOW - 23 * H).toISOString() }))];
  const result = lastResults(rows, [job([c])]).find((x) => x.videoId === r.videoId)!;
  assert.equal(result.views48, null); assert.equal(result.views24, 0);
  assert.equal(result.retryState, "replaced by retry"); assert.equal(result.canRestore, true);
  c.flopRetry!.restoredAt = "restored";
  const restored = lastResults([r], [job([c])])[0];
  assert.equal(restored.retryState, "restored"); assert.equal(restored.canRestore, false);
});
