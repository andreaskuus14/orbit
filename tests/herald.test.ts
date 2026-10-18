import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHerald, pickDue, uploadNudge, trendCards, briefCard, morningCard, breakingCards, fromNotify, MAX_PER_HOUR, type HeraldCard } from "../src/lib/herald-pure.ts";

const H = 3_600_000;
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime(); // local time, like the app
const card = (key: string): HeraldCard => ({ key, kind: "trend", title: key, actions: [] });
const fresh = () => parseHerald(null, 0);

test("pickDue dedupes by key, rate-limits per hour and respects room", () => {
  const T = at(2026, 10, 18, 15);
  let r = pickDue(fresh(), [card("a"), card("a"), card("b")], T, true);
  assert.deepEqual(r.show.map((c) => c.key), ["a", "b"]);
  r = pickDue(r.state, [card("a"), card("c"), card("d"), card("e")], T + 1000, true, 1);
  assert.deepEqual(r.show.map((c) => c.key), ["c"]); // a already seen; room 1
  r = pickDue(r.state, r.queue, T + 2000, true);
  assert.deepEqual(r.show.map((c) => c.key), ["d"]); // 4 per hour
  assert.equal(r.state.shown.length, MAX_PER_HOUR);
  assert.deepEqual(r.queue.map((c) => c.key), ["e"]);
  r = pickDue(r.state, r.queue, T + H + 3000, true);
  assert.deepEqual(r.show.map((c) => c.key), ["e"]); // the hour rolled over
});

test("hidden, muted or snoozed: nothing shows, the queue waits", () => {
  const T = 1_000_000_000_000;
  assert.equal(pickDue(fresh(), [card("a")], T, false).show.length, 0);
  assert.equal(pickDue(fresh(), [card("a")], T, false).queue.length, 1);
  assert.equal(pickDue({ ...fresh(), mute: true }, [card("a")], T, true).show.length, 0);
  assert.equal(pickDue({ ...fresh(), snooze: T + 1 }, [card("a")], T, true).show.length, 0);
  assert.equal(pickDue({ ...fresh(), snooze: T - 1 }, [card("a")], T, true).show.length, 1);
});

test("parseHerald prunes old keys and survives garbage", () => {
  const T = 1_000_000_000_000;
  const s = parseHerald(JSON.stringify({ seen: { old: T - 8 * 24 * H, new: T - H, bad: "x" }, shown: [T - 2 * H, T - 60_000], snooze: T - 1, mute: true }), T);
  assert.deepEqual(s, { seen: { new: T - H }, shown: [T - 60_000], snooze: 0, mute: true });
  assert.deepEqual(parseHerald("{nope", T), fresh());
  assert.deepEqual(parseHerald("[1]", T), fresh());
});

test("uploadNudge: streak at risk, plain nudge, quiet when covered", () => {
  const pub = (ms: number, status = "done") => ({ clips: [{ publish: { status, at: new Date(ms).toISOString() } }] });
  const now = at(2026, 10, 18, 15);
  const streak = uploadNudge({ jobs: [pub(at(2026, 10, 17, 10)), pub(at(2026, 10, 16, 10)), pub(at(2026, 10, 15, 10))] }, now);
  assert.equal(streak?.title, "Day 4 streak at risk");
  assert.equal(streak?.key, "upload:2026-10-18");
  assert.deepEqual(streak?.actions[0].nav, { panel: "studio", view: "review" });
  assert.equal(uploadNudge({ jobs: [pub(at(2026, 10, 10, 10))] }, now)?.title, "You haven't uploaded today");
  assert.equal(uploadNudge({ jobs: [pub(at(2026, 10, 17, 10)), pub(at(2026, 10, 18, 9))] }, now), null); // done today
  const later = { clips: [{ publish: { status: "scheduled", at: new Date(now - H).toISOString(), scheduledFor: new Date(at(2026, 10, 18, 20)).toISOString() } }] };
  assert.equal(uploadNudge({ jobs: [pub(at(2026, 10, 17, 10)), later] }, now), null); // scheduled for tonight
  assert.equal(uploadNudge({ jobs: [pub(at(2026, 10, 17, 10))] }, at(2026, 10, 18, 9)), null); // morning: not yet
  assert.equal(uploadNudge({ jobs: [] }, now), null); // never published from ORBIT
  assert.equal(uploadNudge({ jobs: [{ clips: [{ publish: { status: "failed", at: new Date(at(2026, 10, 17, 10)).toISOString() } }] }] }, now), null);
});

test("trendCards: strong risers only; YouTube gets Clip it with a watch URL", () => {
  const cards = trendCards({
    risers: [{ universeId: 1, name: "Obby", growthPct: 80, window: "1h", strong: true }, { universeId: 2, name: "Meh", growthPct: 5, window: "24h", strong: false }],
    yt: { risers: [{ id: "dQw4w9WgXcQ", title: "Huge", channel: "Ch", strong: true }, { id: "abcdefghijk", title: "Weak", channel: "Ch", strong: false }] },
  });
  assert.deepEqual(cards.map((c) => c.key), ["trend:yt:dQw4w9WgXcQ", "trend:rbx:1"]);
  assert.equal(cards[0].actions[0].clip, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.deepEqual(cards[1].actions[0].nav, { panel: "creation" });
  assert.deepEqual(trendCards({}), []);
});

test("briefCard and morningCard", () => {
  const T = at(2026, 10, 18, 8);
  assert.equal(briefCard([{ id: "b1", title: "Pulse", created_at: new Date(T - H).toISOString() }], T)?.key, "brief:b1");
  assert.equal(briefCard([{ id: "b1", title: "Pulse", created_at: new Date(T - 3 * H).toISOString() }], T), null);
  assert.equal(briefCard(undefined, T), null);
  assert.equal(morningCard(null, T)?.key, "morning:2026-10-18");
  assert.equal(morningCard("2026-10-18", T), null);
  assert.equal(morningCard(null, at(2026, 10, 18, 4)), null);
});

test("breakingCards: ≥3 distinct sources on one story within the hour", () => {
  const T = 1_000_000_000_000, iso = (m: number) => new Date(T - m * 60_000).toISOString();
  const a = (title: string, source: string, min: number) => ({ title, url: `https://${source}.com/${min}`, source, published_at: iso(min) });
  const list = [
    a("Massive earthquake strikes central Japan coast", "reuters", 40),
    a("Earthquake strikes Japan coast, tsunami warning issued", "bbc", 30),
    a("Japan earthquake: strong quake strikes coast", "bbc", 25), // same source twice counts once
    a("Strong earthquake strikes Japan's coast", "ap", 20),
    a("Local football club wins cup final", "espn", 10),
    a("Earthquake strikes Japan coast again", "cnn", 90), // too old
  ];
  const cards = breakingCards(list, T);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, "breaking:https://reuters.com/40");
  assert.equal(cards[0].body, "3 sources in the last hour");
  assert.deepEqual(breakingCards(list.slice(0, 3), T), []); // only 2 distinct sources
  assert.deepEqual(breakingCards(undefined, T), []);
});

test("fromNotify mirrors studio/agents only", () => {
  assert.equal(fromNotify({ title: "3 new clips ready", kind: "studio", nav: { panel: "studio", view: "review" } })?.actions[0].label, "Open");
  assert.equal(fromNotify({ title: "Reminder", kind: "life" }), null);
  assert.equal(fromNotify({ title: "", kind: "agents" }), null);
  assert.notEqual(fromNotify({ title: "Agent task finished", body: "Task 1", kind: "agents" })?.key, fromNotify({ title: "Agent task finished", body: "Task 2", kind: "agents" })?.key);
});
