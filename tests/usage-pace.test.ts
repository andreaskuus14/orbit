import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_REASON, PRESENT_MS, beatDue, inFreshWindow, isPresent, lastActiveAt, paceHold, paceReason, tallinnMinutes } from "../src/lib/usage-pace-pure.ts";
import { emptyMeter, holdReason, patchSettings, parseMeter, paceFor, DEFAULT_SETTINGS, type Call } from "../src/lib/usage-meter-pure.ts";

// Winter (EET, UTC+2) and summer (EEST, UTC+3) instants: Tallinn clock = UTC + 2 / + 3.
const at = (iso: string) => Date.parse(iso);
const winter = (hm: string) => at(`2026-01-15T${hm}:00+02:00`);
const summer = (hm: string) => at(`2026-07-15T${hm}:00+03:00`);

test("Tallinn minutes follow DST", () => {
  assert.equal(tallinnMinutes(at("2026-01-15T05:30:00Z")), 7 * 60 + 30);
  assert.equal(tallinnMinutes(at("2026-07-15T05:30:00Z")), 8 * 60 + 30);
});

test("presence: any signal within 15 min counts, older or future-skewed ones do not", () => {
  const now = winter("12:00");
  assert.equal(isPresent({}, now), false);
  assert.equal(isPresent({ ui: now - 60_000 }, now), true);
  assert.equal(isPresent({ core: now - PRESENT_MS + 1 }, now), true);
  assert.equal(isPresent({ core: now - PRESENT_MS }, now), false);
  assert.equal(isPresent({ voice: now - 5 * 60_000 }, now), true);
  assert.equal(isPresent({ ui: now + 10 * 60_000 }, now), false); // clock jump: ignored
  assert.equal(lastActiveAt({ ui: now - 9_000, core: now - 3_000, voice: now - 100_000 }, now), now - 3_000);
});

test("active owner: background holds from 50% of the soft budget, runs below it", () => {
  const now = winter("14:00"), sig = { ui: now - 30_000 };
  assert.equal(paceHold({ now, pct: 49, sig }), null);
  assert.deepEqual(paceHold({ now, pct: 50, sig }), { kind: "active", reason: ACTIVE_REASON });
  assert.equal(paceHold({ now, pct: 95, sig })?.kind, "active");
  assert.equal(paceHold({ now, pct: 95, sig: { ui: now - PRESENT_MS - 1 } }), null); // away: today's behaviour, no new hold
  assert.equal(paceHold({ now, pct: 95 }), null);
});

test("pre-morning window: 2 h before 07:30 by default, [05:30, 07:30) Tallinn, in winter and summer", () => {
  for (const day of [winter, summer]) {
    assert.equal(inFreshWindow(day("05:29")), false);
    assert.equal(inFreshWindow(day("05:30")), true);
    assert.equal(inFreshWindow(day("07:29")), true);
    assert.equal(inFreshWindow(day("07:30")), false); // the brief slot itself is outside the window
    assert.equal(inFreshWindow(day("12:00")), false);
  }
  const p = paceHold({ now: winter("06:00"), pct: 0 });
  assert.deepEqual(p, { kind: "fresh", reason: "Keeping your window fresh until 07:30", until: "07:30" });
  assert.equal(paceReason(p!), p!.reason);
});

test("pre-morning window wraps midnight and honours the lead and off", () => {
  assert.equal(inFreshWindow(winter("22:29"), "00:30", 120), false);
  assert.equal(inFreshWindow(winter("22:30"), "00:30", 120), true);
  assert.equal(inFreshWindow(winter("23:59"), "00:30", 120), true);
  assert.equal(inFreshWindow(winter("00:00"), "00:30", 120), true);
  assert.equal(inFreshWindow(winter("00:30"), "00:30", 120), false);
  assert.equal(inFreshWindow(winter("06:00"), "07:30", 0), false); // lead 0 = off
  assert.equal(inFreshWindow(winter("06:00"), "07:30", 30), false);
  assert.equal(inFreshWindow(winter("07:10"), "07:30", 30), true);
  assert.equal(inFreshWindow(winter("03:00"), "07:30", 9999), true); // capped at 6 h: window starts 01:30, so 03:00 is inside
  assert.equal(inFreshWindow(winter("01:29"), "07:30", 9999), false);
  assert.equal(inFreshWindow(winter("06:00"), "nope", 120), false);
});

test("fresh window holds regardless of budget; it wins over presence", () => {
  const now = winter("06:15");
  assert.equal(paceHold({ now, pct: 0, sig: { ui: now } })?.kind, "fresh");
  assert.equal(paceHold({ now: winter("09:00"), pct: 0 }), null);
});

const meterWith = (n: number, now: number) => {
  const m = emptyMeter();
  m.calls = Array.from({ length: n }, (_, i): Call => ({ at: now - i * 1000, purpose: "agent", model: "sonnet", inTok: 1, outTok: 1, ms: 1, ok: true }));
  return m;
};

test("holdReason: pacer applies only with a ctx; hard limit and the soft budget keep their own words and order", () => {
  const now = winter("14:00"), sig = { ui: now - 1000 };
  const m = meterWith(75, now); // 50% of 150
  assert.equal(holdReason(m, now), ""); // no ctx: unchanged
  assert.equal(holdReason(m, now, { sig }), ACTIVE_REASON);
  assert.equal(holdReason(meterWith(74, now), now, { sig }), "");
  assert.match(holdReason(meterWith(130, now), now, { sig }), /^Heavy use: 87%/);
  m.limit = { until: now + 60_000, at: now, text: "x" };
  assert.match(holdReason(m, now, { sig }), /usage limit reached/);
  assert.equal(paceFor(meterWith(1, now), winter("06:00"), { sig: {} })?.kind, "fresh");
  assert.equal(paceFor(meterWith(1, now), winter("06:00")), null);
});

test("settings: morningAt and freshLeadMin validate; old saved meters keep the defaults", () => {
  const cur = { ...DEFAULT_SETTINGS };
  assert.deepEqual(patchSettings({ morningAt: "08:00", freshLeadMin: 90 }, cur), { ...cur, morningAt: "08:00", freshLeadMin: 90 });
  assert.equal(typeof patchSettings({ morningAt: "8am" }, cur), "string");
  assert.equal(typeof patchSettings({ freshLeadMin: 361 }, cur), "string");
  assert.equal((patchSettings({ freshLeadMin: 0 }, cur) as typeof cur).freshLeadMin, 0);
  const old = parseMeter(JSON.stringify({ calls: [], settings: { calls5h: 100, tokens5h: 0, warnPct: 80 } }));
  assert.equal(old.settings.freshLeadMin, 120);
  assert.equal(old.settings.morningAt, "07:30");
  const lead0 = emptyMeter(); lead0.settings.freshLeadMin = 0;
  assert.equal(paceFor(lead0, winter("06:00"), { sig: {} }), null);
});

test("client heartbeat: visible tab, at most once a minute", () => {
  assert.equal(beatDue(100_000, 0, true), true);
  assert.equal(beatDue(100_000, 50_000, true), false);
  assert.equal(beatDue(110_000, 50_000, true), true);
  assert.equal(beatDue(200_000, 0, false), false);
});
