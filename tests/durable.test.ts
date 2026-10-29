import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_SESSIONS, REPLAY_WINDOW, TICK_MAX, SESSION_MAX_AGE, ackTrack, capSessions, emptyTrack, liveSession, parseCursors, parseSessions, takeNew, type Track } from "../src/lib/durable-pure.ts";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-durable-"));
const { coreSessionStore, claimEvents: claimRaw, ackEvent, clearCursor, eventGaps, getCursor } = await import("../src/lib/durable.ts");
/** take + act (nothing) + acknowledge, the way a consumer that finishes its work uses it. */
const claimEvents = async (...a: Parameters<typeof claimRaw>) => { const got = await claimRaw(...a); for (const e of got) await ackEvent(a[1], e.id); return got; };
const G = globalThis as unknown as { __orbitDurable: { sessions?: unknown; cursors?: unknown; tracks?: unknown; chain: Promise<unknown> } };
/** Simulated server restart: wait for pending writes, then drop everything held in memory. */
const restart = async () => { await G.__orbitDurable.chain; G.__orbitDurable.sessions = undefined; G.__orbitDurable.cursors = undefined; G.__orbitDurable.tracks = undefined; };

test("parseSessions keeps valid entries only and caps to the newest", () => {
  const m = parseSessions({ a: { id: "s-1", at: 5 }, "bad key!": { id: "s", at: 1 }, b: { id: 7, at: 1 }, c: { id: "s-3" }, d: null });
  assert.deepEqual(m, { a: { id: "s-1", at: 5 } });
  assert.deepEqual(parseSessions([1, 2]), {});
  const many = Object.fromEntries(Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => [`c${i}`, { id: `s${i}`, at: i }]));
  const capped = capSessions(many);
  assert.equal(Object.keys(capped).length, MAX_SESSIONS);
  assert.ok(!("c0" in capped) && `c${MAX_SESSIONS + 4}` in capped);
});

test("liveSession ignores sessions past the max age", () => {
  const m = { a: { id: "s", at: 0 } };
  assert.equal(liveSession(m, "a", SESSION_MAX_AGE - 1)?.id, "s");
  assert.equal(liveSession(m, "a", SESSION_MAX_AGE), null);
  assert.equal(liveSession(m, "x", 0), null);
});

test("restart keeps the CORE session mapping; delete (failed resume / deleted chat) also survives restart", async () => {
  coreSessionStore.set("chat-1", { id: "sess-1", resume: true });
  coreSessionStore.set("chat-2", { id: "sess-2", resume: true });
  await restart();
  assert.deepEqual(coreSessionStore.get("chat-1"), { id: "sess-1", resume: true });
  coreSessionStore.delete("chat-2");
  await restart();
  assert.equal(coreSessionStore.get("chat-2"), undefined);
  assert.equal(coreSessionStore.get("chat-1")?.id, "sess-1");
});

test("a corrupt session file starts empty instead of crashing", async () => {
  await restart();
  await writeFile(path.join(process.env.ORBIT_DATA_DIR!, "core-sessions.json"), "{not json");
  assert.equal(coreSessionStore.get("chat-1"), undefined);
});

test("parseCursors drops bad values", () => {
  assert.deepEqual(parseCursors({ rules: 12, a: -1, b: "3", c: 1.5 }), { rules: 12 });
  assert.deepEqual(parseCursors(null), {});
});

test("takeNew: drops processed and duplicate ids, orders, takes the oldest up to the cap", () => {
  const r = takeNew(10, [{ id: 13 }, { id: 9 }, { id: 11 }, { id: 13 }, { id: 10 }]);
  assert.deepEqual(r.fresh.map((e) => e.id), [11, 13]);
  assert.equal(r.next, 13);
  assert.deepEqual(takeNew(10, []), { fresh: [], next: 10 });
  const capped = takeNew(0, Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })), 5);
  assert.deepEqual(capped.fresh.map((e) => e.id), [1, 2, 3, 4, 5]);
  assert.equal(capped.next, 5); // the rest carries to the next call
});

// A tiny stand-in for the Supabase query builder over an in-memory events table.
type Ev = { id: number; user_id: string; type: string; payload: unknown; created_at: string };
function fakeSb(rows: Ev[]) {
  const q = () => {
    let out = [...rows]; let n = Infinity;
    const b = {
      select: () => b,
      gt: (_c: string, v: number) => { out = out.filter((r) => r.id > v); return b; },
      gte: (_c: string, v: string) => { out = out.filter((r) => r.created_at >= v); return b; },
      in: (_c: string, v: string[]) => { out = out.filter((r) => v.includes(r.type)); return b; },
      order: (_c: string, o?: { ascending: boolean }) => { out.sort((a, z) => (o?.ascending ?? true ? a.id - z.id : z.id - a.id)); return b; },
      limit: (k: number) => { n = k; return b; },
      then: (ok: (v: { data: Ev[]; error: null }) => unknown) => Promise.resolve({ data: out.slice(0, n), error: null }).then(ok),
    };
    return b;
  };
  return { from: () => q() } as never;
}
const NOW = Date.parse("2026-10-28T12:00:00Z");
const ev = (id: number, agoMs = 60_000, type = "memory.created"): Ev => ({ id, user_id: "u", type, payload: {}, created_at: new Date(NOW - agoMs).toISOString() });

test("events during downtime are processed exactly once, across restarts", async () => {
  const rows = [ev(1), ev(2)];
  const sb = fakeSb(rows);
  assert.deepEqual(await claimEvents(sb, "t1", ["memory.created"], NOW), []); // first ever run: starts at the newest, no replay
  assert.equal(getCursor("t1"), 2);
  rows.push(ev(3), ev(4, 60_000, "other.type"), ev(5));
  assert.deepEqual((await claimEvents(sb, "t1", ["memory.created"], NOW)).map((e) => e.id), [3, 5]);
  await restart(); // server down
  rows.push(ev(6), ev(7));
  assert.deepEqual((await claimEvents(sb, "t1", ["memory.created"], NOW)).map((e) => e.id), [6, 7]); // missed while down
  await restart();
  assert.deepEqual(await claimEvents(sb, "t1", ["memory.created"], NOW), []); // nothing runs twice
  const saved = JSON.parse(await readFile(path.join(process.env.ORBIT_DATA_DIR!, "event-cursors.json"), "utf8"));
  assert.equal(saved.t1, 7);
});

test("a busy tick never drops events: 700 at once are handled over 4 ticks, none twice", async () => {
  const rows = [ev(1)];
  const sb = fakeSb(rows);
  await claimEvents(sb, "t2", ["memory.created"], NOW);
  for (let i = 2; i < 702; i++) rows.push(ev(i));
  const seen: number[] = []; let ticks = 0;
  for (;;) {
    const got = await claimEvents(sb, "t2", ["memory.created"], NOW);
    if (!got.length) break;
    assert.ok(got.length <= TICK_MAX);
    seen.push(...got.map((e) => e.id)); ticks++;
    if (ticks === 2) await restart(); // a restart mid-backlog carries on from the saved cursor
  }
  assert.equal(ticks, 4);
  assert.deepEqual(seen, Array.from({ length: 700 }, (_, i) => i + 2));
});

test("downtime replay is bounded to the last 24 h, and the skipped ones are counted for Doctor", async () => {
  const rows = [ev(1)];
  const sb = fakeSb(rows);
  await claimEvents(sb, "t4", ["memory.created"], NOW);
  rows.push(ev(2, REPLAY_WINDOW + 1000), ev(3, REPLAY_WINDOW + 10), ev(4)); // two older than the window: stale, skipped
  await restart();
  assert.deepEqual((await claimEvents(sb, "t4", ["memory.created"], NOW)).map((e) => e.id), [4]);
  assert.deepEqual(await claimEvents(sb, "t4", ["memory.created"], NOW), []);
  assert.equal(eventGaps().find((g) => g.consumer === "t4")?.skipped, 2);
  assert.equal(getCursor("t4"), 4);
});

test("ackTrack: the cursor stops below the oldest unacknowledged event", () => {
  let t: Track = { ...emptyTrack(), inflight: { "3": 1, "5": 1, "8": 1 } }, c = 2;
  ({ cursor: c, track: t } = ackTrack(c, t, 5)); assert.equal(c, 2); assert.deepEqual(t.done, [5]);
  ({ cursor: c, track: t } = ackTrack(c, t, 3)); assert.equal(c, 5); assert.deepEqual(t.done, [5, 3]); // kept until the new cursor is saved
  ({ cursor: c, track: t } = ackTrack(c, t, 8)); assert.equal(c, 8); assert.deepEqual(t.done, [8]);
});

test("crash after take, before act: the event is handled exactly once after restart", async () => {
  const rows = [ev(1)]; const sb = fakeSb(rows);
  await claimRaw(sb, "c1", ["memory.created"], NOW);
  rows.push(ev(2), ev(3));
  assert.deepEqual((await claimRaw(sb, "c1", ["memory.created"], NOW)).map((e) => e.id), [2, 3]);
  await ackEvent("c1", 2); // 3 taken, never acted on: crash
  await restart();
  const acted: number[] = [];
  for (let i = 0; i < 3; i++) for (const e of await claimRaw(sb, "c1", ["memory.created"], NOW)) { acted.push(e.id); await ackEvent("c1", e.id); }
  assert.deepEqual(acted, [3]);
  assert.equal(getCursor("c1"), 3);
});

test("crash after act, before ack: the retry's idempotency key prevents a duplicate; a second crash gives up", async () => {
  const rows = [ev(1)]; const sb = fakeSb(rows);
  const created = new Set<string>(); // stands in for tasks keyed by event:<consumer>:<id>
  const act = (id: number) => created.add(`event:c2:${id}`);
  await claimRaw(sb, "c2", ["memory.created"], NOW);
  rows.push(ev(2));
  for (const e of await claimRaw(sb, "c2", ["memory.created"], NOW)) act(e.id); // acted, crash before ack
  await restart();
  const again = await claimRaw(sb, "c2", ["memory.created"], NOW);
  assert.deepEqual(again.map((e) => e.id), [2]); // retried once
  for (const e of again) act(e.id); // finds the existing key
  assert.equal(created.size, 1);
  await restart(); // crashed again before ack
  assert.deepEqual(await claimRaw(sb, "c2", ["memory.created"], NOW), []);
  assert.equal(eventGaps().find((g) => g.consumer === "c2")?.gaveUp, 1);
  assert.equal(getCursor("c2"), 2);
});

test("a >24 h backlog bigger than one page is counted in one tick, not acted on", async () => {
  const rows = [ev(1)]; const sb = fakeSb(rows);
  await claimRaw(sb, "c3", ["memory.created"], NOW);
  for (let i = 2; i < 2 + TICK_MAX * 3; i++) rows.push(ev(i, REPLAY_WINDOW * 2));
  rows.push(ev(10_000));
  assert.deepEqual((await claimEvents(sb, "c3", ["memory.created"], NOW)).map((e) => e.id), [10_000]);
  assert.equal(eventGaps().find((g) => g.consumer === "c3")?.skipped, TICK_MAX * 3);
});

test("clearCursor: a consumer with no listeners restarts from the newest event", async () => {
  const sb = fakeSb([ev(1), ev(2)]);
  await claimEvents(sb, "t3", ["memory.created"], NOW);
  clearCursor("t3");
  await restart();
  assert.equal(getCursor("t3"), undefined);
  assert.deepEqual(await claimEvents(sb, "t3", ["memory.created"], NOW), []);
});
