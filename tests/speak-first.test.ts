import { test } from "node:test";
import assert from "node:assert/strict";
import { SPEAK_FIRST, SPEAK_FIRST_START, decideMoment, parseSpeakFirst, type MomentSignals, type SpeakFirstState } from "../src/lib/speak-first-pure.ts";

// 2026-10-26 is after the DST switch: Tallinn = UTC+2.
const at = (h: number, m = 0, d = 26) => Date.UTC(2026, 9, d, h - 2, m);
const MIN = 60_000;
const sig = (now: number, o: Partial<MomentSignals> = {}): MomentSignals => ({
  now, lastInputAt: now - 25 * MIN, visible: true, stopAll: false, muted: false, inCall: false, conversation: false, focus: false, speak: true,
  briefUnseen: true, ...o,
});
const go = (s: MomentSignals, st: SpeakFirstState = SPEAK_FIRST_START, lang: "en" | "et" = "en") => decideMoment(st, s, lang);

test("a return after 20+ min with something waiting speaks once", () => {
  const r = go(sig(at(10)));
  assert.equal(r.moment?.kind, "brief");
  assert.equal(r.moment?.line, "Welcome back. Your morning brief is ready.");
  assert.equal(r.moment?.voice, true);
  assert.equal(r.state.count, 1);
});

test("not a return: under 20 min away, or no previous input known", () => {
  assert.equal(go(sig(at(10), { lastInputAt: at(10) - 19 * MIN })).moment, null);
  assert.equal(go(sig(at(10), { lastInputAt: 0 })).moment, null);
  assert.ok(go(sig(at(10), { lastInputAt: at(10) - SPEAK_FIRST.awayMs })).moment);
});

test("every cap blocks and uses nothing up", () => {
  const caps: Partial<MomentSignals>[] = [{ visible: false }, { stopAll: true }, { muted: true }, { inCall: true }, { conversation: true }, { focus: true }];
  for (const c of caps) {
    const r = go(sig(at(10), c));
    assert.equal(r.moment, null, JSON.stringify(c));
    assert.equal(r.state.count, 0);
  }
});

test("quiet hours 23-08 (Tallinn) never speak", () => {
  for (const h of [23, 0, 3, 7]) assert.equal(go(sig(at(h))).moment, null, `hour ${h}`);
  assert.ok(go(sig(at(8))).moment);
  assert.ok(go(sig(at(22, 59))).moment);
});

test("off in settings: silent; default on, stored off stays off", () => {
  assert.equal(go(sig(at(10)), { ...SPEAK_FIRST_START, on: false }).moment, null);
  assert.equal(parseSpeakFirst(null).on, true);
  assert.equal(parseSpeakFirst("garbage").on, true);
  assert.equal(parseSpeakFirst(JSON.stringify({ on: false })).on, false);
});

test("max 4 a day, and a new day resets", () => {
  let st = SPEAK_FIRST_START;
  const loops = Array.from({ length: 6 }, (_, i) => ({ key: `l${i}`, title: `Loop ${i}` }));
  let said = 0;
  for (let i = 0; i < 6; i++) { const r = go(sig(at(10 + i), { loopsToday: loops, briefUnseen: false }), st); st = r.state; if (r.moment) said++; }
  assert.equal(said, SPEAK_FIRST.maxPerDay);
  assert.ok(go(sig(at(10, 0, 27), { loopsToday: loops, briefUnseen: false }), st).moment);
});

test("the same item is not raised twice in a day", () => {
  const r1 = go(sig(at(10)));
  const r2 = go(sig(at(11)), r1.state);
  assert.equal(r2.moment, null);
  assert.equal(r2.state.count, 1);
});

test("priority: incident > meeting < 30 min > approval > 2 h > loop due today > brief", () => {
  const now = at(10);
  const all = sig(now, {
    incidents: [{ key: "svc:db", title: "Supabase is down" }],
    events: [{ title: "Studio crit", start: new Date(now + 12 * MIN).toISOString(), allDay: false }],
    approvals: [{ id: "a1", title: "Email to Mari", since: now - 3 * 3600_000 }],
    loopsToday: [{ key: "p1", title: "Send the plans" }],
  });
  let st = SPEAK_FIRST_START;
  const kinds: string[] = [];
  for (let i = 0; i < 4; i++) { const r = go({ ...all, now: now + i * 1000, lastInputAt: now - 25 * MIN }, st); st = r.state; kinds.push(r.moment!.kind); }
  assert.deepEqual(kinds, ["incident", "meeting", "approval", "loop"]);
});

test("thresholds: approval under 2 h, meeting past or over 30 min, all-day events are ignored", () => {
  const now = at(10);
  const r = go(sig(now, {
    briefUnseen: false,
    approvals: [{ id: "a", title: "x", since: now - SPEAK_FIRST.approvalMs + MIN }],
    events: [
      { title: "later", start: new Date(now + 31 * MIN).toISOString(), allDay: false },
      { title: "gone", start: new Date(now - MIN).toISOString(), allDay: false },
      { title: "holiday", start: new Date(now + 5 * MIN).toISOString(), allDay: true },
    ],
  }));
  assert.equal(r.moment, null);
});

test("voice follows the speak setting; the line is still shown", () => {
  const r = go(sig(at(10), { speak: false }));
  assert.equal(r.moment?.voice, false);
  assert.ok(r.moment?.line);
});

test("Estonian lines", () => {
  const now = at(10);
  assert.equal(go(sig(now), SPEAK_FIRST_START, "et").moment?.line, "Tere tagasi. Sinu hommikune ülevaade on valmis.");
  const m = go(sig(now, { events: [{ title: "Koosolek", start: new Date(now + 10 * MIN).toISOString(), allDay: false }] }), SPEAK_FIRST_START, "et").moment;
  assert.equal(m?.line, "Tere tagasi. Koosolek algab 10 min pärast.");
  const a = go(sig(now, { approvals: [{ id: "a", title: "Arve", since: now - 3 * 3600_000 }] }), SPEAK_FIRST_START, "et").moment;
  assert.equal(a?.line, "Tere tagasi. Arve ootab sinu kinnitust juba 3 h.");
});
