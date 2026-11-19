import { test } from "node:test";
import assert from "node:assert/strict";
import { alertable, parseSelfCheck, probeWanted, selfCheckDue, selfCheckPlan, tallinnDay } from "../src/lib/selfcheck-pure.ts";
import { buildCheck, check } from "../src/lib/doctor-pure.ts";

const DAY = 86_400_000;
// 2026-11-20 is winter time in Tallinn (UTC+2).
const at = (hhmm: string, day = "2026-11-20") => Date.parse(`${day}T${hhmm}:00+02:00`);

test("due once a Tallinn day, from 09:00, never in quiet hours, off switch", () => {
  assert.equal(selfCheckDue({}, at("08:59")), false);
  assert.equal(selfCheckDue({}, at("09:00")), true);
  assert.equal(selfCheckDue({ day: "2026-11-20" }, at("15:00")), false);
  assert.equal(selfCheckDue({ day: "2026-11-19" }, at("15:00")), true);
  assert.equal(selfCheckDue({ day: "2026-11-19" }, at("23:30")), false, "quiet hours: waits for tomorrow 09:00");
  assert.equal(selfCheckDue({}, at("10:00"), [9, 12]), false, "custom quiet hours");
  assert.equal(selfCheckDue({}, at("10:00"), null, "off"), false);
  assert.equal(tallinnDay(Date.parse("2026-11-20T22:30:00Z")), "2026-11-21", "Tallinn day, not UTC");
});

test("pushes only for newly failing checks; a lasting failure pushes once", () => {
  const fail = check("claude", "Claude", "fail", "login expired"), ok = check("disk", "Disk", "ok", "fine");
  const d1 = selfCheckPlan({}, [fail, ok], at("09:00"));
  assert.deepEqual([d1.push, d1.fresh, d1.failing], [true, ["claude"], ["claude"]]);
  const d2 = selfCheckPlan(d1.state, [fail, ok], at("09:00", "2026-11-21"));
  assert.equal(d2.push, false, "same failure the next day: no push");
  assert.equal(d2.state.pushed, d1.state.pushed, "keeps when it last pushed");
  const d3 = selfCheckPlan(d2.state, [check("claude", "Claude", "ok", "fine")], at("09:00", "2026-11-22"));
  assert.deepEqual([d3.push, d3.failing], [false, []]);
  assert.equal(selfCheckPlan(d3.state, [fail], at("09:00", "2026-11-23")).push, true, "broke again after recovering: pushes");
});

test("skip: a failure already pushed by its own path is remembered, not pushed", () => {
  const p = selfCheckPlan({}, [check("claude", "Claude", "fail", "x")], 0, ["claude"]);
  assert.deepEqual([p.push, p.failing], [false, ["claude"]]);
  assert.equal(selfCheckPlan(p.state, [check("claude", "Claude", "fail", "x")], DAY).push, false);
});

test("alertable: fails, and a production build failure (shown as a warning); not other warnings", () => {
  assert.equal(alertable(buildCheck(true, "error TS2304: x", true)), true);
  assert.equal(alertable(buildCheck(false, "", false)), false, "dev server warning is not a failure");
  assert.equal(alertable(buildCheck(false, "", true)), false);
  assert.equal(alertable(check("whisper", "W", "warn", "backup broken")), false);
  assert.equal(alertable(check("x", "X", "fail", "y")), true);
});

test("login probe: only when no call worked in a day and nothing else covers it", () => {
  const now = at("09:00");
  assert.equal(probeWanted([], now, false, false), true);
  assert.equal(probeWanted([{ at: now - 3600_000, ok: true }], now, false, false), false);
  assert.equal(probeWanted([{ at: now - 2 * DAY, ok: true }, { at: now - 60_000, ok: false }], now, false, false), true);
  assert.equal(probeWanted([], now, true, false), false, "login outage open: its own 15-min probe");
  assert.equal(probeWanted([], now, false, true), false, "usage limit: no call");
});

test("state file: damaged or odd input is a fresh start", () => {
  assert.deepEqual(parseSelfCheck(null), {});
  assert.deepEqual(parseSelfCheck("{oops"), {});
  assert.deepEqual(parseSelfCheck('{"day":"2026-11-20","failing":["a",3],"x":1}'), { day: "2026-11-20", failing: ["a"] });
});
