import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyState, parseState, RATE_MS, step } from "../src/lib/studio-notify.ts";

const T = Date.parse("2026-10-16T12:00:00Z");
const clip = (id: string, status: string, publish?: { status: string; scheduledFor?: string }) => ({ id, title: `Clip ${id}`, status, publish });
const job = (id: string, status: string, clips: ReturnType<typeof clip>[] = []) => ({ id, source: `${id} video.mp4`, status, clips });

test("first poll is a silent baseline", () => {
  const r = step(emptyState(), { jobs: [job("a", "done", [clip("1", "ready")])] }, T);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.state.seen?.ready, ["a/1"]);
});

test("new ready clips batch into one note with counts and the source name", () => {
  const s0 = step(emptyState(), { jobs: [] }, T).state;
  const r = step(s0, { jobs: [job("Jynxzi 1v1", "done", [clip("1", "ready"), clip("2", "ready"), clip("3", "ready"), clip("4", "ready"), clip("5", "rejected")])] }, T);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].title, "☀ 4 new clips ready — Jynxzi 1v1 video");
  assert.equal(r.notes[0].spoken, "Four new clips are ready.");
});

test("rate limit: one per category per 10 min, later items batched", () => {
  let s = step(emptyState(), { jobs: [] }, T).state;
  let r = step(s, { jobs: [job("a", "done", [clip("1", "ready")])] }, T);
  assert.equal(r.notes.length, 1); s = r.state;
  r = step(s, { jobs: [job("a", "done", [clip("1", "ready"), clip("2", "ready")])] }, T + 60_000);
  assert.equal(r.notes.length, 0); s = r.state;
  r = step(s, { jobs: [job("a", "done", [clip("1", "ready"), clip("2", "ready")]), job("b", "failed")] }, T + 120_000);
  assert.deepEqual(r.notes.map((n) => n.cat), ["failed"]); s = r.state; // other categories aren't held back
  r = step(s, { jobs: [job("a", "done", [clip("1", "ready"), clip("2", "ready"), clip("3", "ready")]), job("b", "failed")] }, T + RATE_MS);
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0].n, 2);
});

test("seen items never re-notify, even after a restart through storage", () => {
  const data = { jobs: [job("a", "failed")] };
  const s = step(step(emptyState(), { jobs: [] }, T).state, data, T).state;
  const restored = parseState(JSON.stringify(s));
  assert.deepEqual(step(restored, data, T + 2 * RATE_MS).notes, []);
  assert.deepEqual(parseState("garbage"), emptyState());
});

test("blocked downloads, other download failures, and Shorts going live", () => {
  const s = step(emptyState(), { jobs: [job("a", "done", [clip("1", "approved", { status: "scheduled", scheduledFor: "2026-10-16T13:00:00Z" })])] }, T).state;
  const r = step(s, {
    jobs: [job("a", "done", [clip("1", "approved", { status: "scheduled", scheduledFor: "2026-10-16T13:00:00Z" })])],
    downloads: [{ id: "d1", url: "https://y/1", status: "failed", error: "YouTube blocked the download; try again later" },
      { id: "d2", url: "https://y/2", status: "failed", error: "disk full" }],
  }, T + 3_600_000);
  assert.deepEqual(r.notes.map((n) => n.cat).sort(), ["blocked", "failed", "live"]);
  assert.equal(r.notes.find((n) => n.cat === "live")?.title, "📺 Your Short is live — Clip 1");
});
