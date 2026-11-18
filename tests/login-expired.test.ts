import { test } from "node:test";
import assert from "node:assert/strict";
import { PROBE_MS, emptyMeter, holdReason, hardHoldReason, loginFailed, noteLogin, parseMeter, probeDue } from "../src/lib/usage-meter-pure.ts";
import { describeFailure } from "../src/lib/core-capability-pure.ts";
import { errorCategory } from "../src/lib/failure-report-pure.ts";
import { digestMsg, dailyText } from "../src/lib/daily-pure.ts";
import { gate, pushLabel } from "../src/lib/remote-push-pure.ts";

// Seen live on the owner's PC, 13–17 Nov 2026: every scheduled Claude job failed with this for 4 days, reported as "unknown".
const LIVE = "Failed to authenticate: OAuth session expired and could not be refreshed";
const NOW = 1_800_000_000_000;

test("the live expired-login text is recognised everywhere", () => {
  assert.ok(loginFailed(LIVE));
  assert.match(describeFailure(LIVE), /run `claude` there and sign in again/);
  assert.equal(errorCategory(LIVE), "auth");
  for (const ok of ["Claude Code timed out after 2 minutes", "Budget exceeded: all 9 Claude calls were used", "fetch failed"]) assert.ok(!loginFailed(ok), ok);
});

test("login outage: first failure opens it once, later ones only re-arm, any success closes it", () => {
  const m = emptyMeter();
  assert.equal(noteLogin(m, false, "fetch failed", NOW), null); // not a login problem
  assert.equal(noteLogin(m, false, LIVE, NOW), "down");
  assert.equal(noteLogin(m, false, LIVE, NOW + 5), "still"); // no second push
  assert.equal(m.login?.at, NOW);
  assert.equal(noteLogin(m, true, "", NOW + 10), "back");
  assert.equal(m.login, null);
  assert.equal(noteLogin(m, true, "", NOW + 20), null);
});

test("while down: background holds, owner clicks don't, one probe per 15 min, survives a restart", () => {
  const m = emptyMeter();
  noteLogin(m, false, LIVE, NOW);
  assert.match(holdReason(m, NOW), /login expired/);
  assert.equal(hardHoldReason(m, NOW), ""); // his own CORE turn still tries: a working call is what clears it
  assert.ok(!probeDue(m, NOW + PROBE_MS - 1));
  assert.ok(probeDue(m, NOW + PROBE_MS));
  const back = parseMeter(JSON.stringify(m));
  assert.equal(back.login?.at, NOW);
});

test("daily digest leads with the expired login and counts it as needing a look", () => {
  const v = { day: "2026-11-18", items: [], loginDown: true };
  const d = digestMsg(v);
  assert.match(d.message, /^Claude login: EXPIRED/);
  assert.equal(d.kind, "failed");
  assert.match(dailyText(v), /Claude login: EXPIRED/);
  assert.doesNotMatch(digestMsg({ day: "2026-11-18", items: [] }).message, /login/);
});

test("the login push has a fixed label and isn't held by quiet hours", () => {
  assert.equal(pushLabel("login").title, "Claude login expired on the PC");
  const night = new Date("2026-11-18T23:30:00+02:00").getTime();
  assert.equal(gate(undefined, "login", night).send, 1);
});
