import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceType, mmss, noAmounts, scopeAllows, screenView, type ScreenIn } from "../src/lib/screen-pure.ts";
import { actionFor } from "../src/lib/remote-web-pure.ts";
import { NonceCache, parseCommand } from "../src/lib/remote-pure.ts";

const cmd = (o: object) => {
  const r = parseCommand(JSON.stringify({ nonce: `n-${Math.random().toString(36).slice(2)}-abcdefgh`, ...o }), new NonceCache());
  if (!r.ok) throw new Error(r.error);
  return r.cmd;
};
const ID = "123e4567-e89b-42d3-a456-426614174000";

test("deviceType: only an explicit screen is a screen; old devices stay phones", () => {
  assert.equal(deviceType({ type: "screen" }), "screen");
  assert.equal(deviceType({}), "phone");
  assert.equal(deviceType({ type: "admin" }), "phone");
});

test("scopeAllows: a screen may only read; approve, reject, stop and ask are refused", () => {
  const all = [cmd({ type: "status" }), cmd({ type: "approval.list" }), cmd({ type: "approve", id: ID }), cmd({ type: "reject", id: ID }), cmd({ type: "stopAll" }), cmd({ type: "core.ask", text: "hi" }), cmd({ type: "navigate", panel: "core" })];
  const allowed = all.filter((c) => scopeAllows("screen", actionFor(c))).map((c) => c.type);
  assert.deepEqual(allowed, ["status"]); // approval.list is out too: it carries email bodies and recipients
  assert.ok(all.every((c) => scopeAllows("phone", actionFor(c))));
  assert.ok(scopeAllows("screen", "screen"));
  for (const a of ["talk", "push", "thumb", "approvals", ""]) assert.equal(scopeAllows("screen", a), false);
});

test("noAmounts: money and credit amounts never reach the screen", () => {
  assert.equal(noAmounts("Deal: bike for €450"), "Deal: bike for …");
  assert.equal(noAmounts("Offer 1,200 EUR accepted"), "Offer … accepted");
  assert.equal(noAmounts("Spend 40 credits on Intro"), "Spend … on Intro");
  assert.equal(noAmounts("$ 9.99 plan and 25 euros"), "… plan and …");
  assert.equal(noAmounts("Fix 3 bugs in level 2"), "Fix 3 bugs in level 2");
  assert.equal(noAmounts("x".repeat(200)).length, 90);
});

const base: ScreenIn = { stop: { on: false }, brief: null, tasks: [], approvals: [], night: null, focus: null };

test("screenView: titles and counts only; bodies, recipients and details are dropped", () => {
  const v = screenView({
    ...base,
    brief: { greeting: "Hey Andreas.", items: [{ kind: "result", title: "Deal: lamp", detail: "about €80", say: "secret words" } as never] },
    approvals: [{ kind: "send", title: "Acme", detail: "BUSINESS email", to: "a@b.c", message: "Dear Acme, the price is €900" } as never],
  }, 0);
  const s = JSON.stringify(v);
  for (const leak of ["a@b.c", "Dear Acme", "€", "secret words", "BUSINESS email"]) assert.ok(!s.includes(leak), leak);
  assert.deepEqual(v.approvals, [{ kind: "send", title: "Acme" }]);
  assert.deepEqual(v.brief, { greeting: "Hey Andreas.", items: [{ kind: "result", title: "Deal: lamp" }] });
});

test("screenView: running agents first, chains show their live step, approvals include waiting tasks", () => {
  const t = (id: string, status: string, title: string, parent_id: string | null = null, agent = "nova") => ({ id, parent_id, agent, title, status, started_at: null, result: "never shown" });
  const v = screenView({ ...base, tasks: [
    t("q", "queued", "Later thing"),
    t("c", "running", "Team: Ship the update"), t("c1", "done", "s1", "c", "rex"), t("c2", "running", "s2", "c", "pixel"),
    t("w", "awaiting_approval", "Draft for €300 order"),
  ] }, 0);
  assert.deepEqual(v.agents.map((a) => [a.id, a.title, a.step]), [["c", "Ship the update", "pixel"], ["q", "Later thing", undefined]]);
  assert.deepEqual(v.approvals, [{ kind: "task", title: "Draft for … order" }]);
  assert.ok(!JSON.stringify(v).includes("never shown"));
});

test("screenView: night counts and focus only while it runs", () => {
  const v = screenView({ ...base,
    night: { enabled: true, from: "01:00", until: "06:30", running: false, queued: 2, report: { done: [{ label: "x" }], approvals: [1, 2], failed: [], stopped: "budget" } },
    focus: { plan: 25, phase: "focus", endAt: 5000, left: 1500 } }, 1000);
  assert.deepEqual(v.night, { enabled: true, window: "01:00–06:30", running: false, queued: 2, done: 1, toApprove: 2, failed: 0, stopped: "Tonight's budget was used up" });
  assert.deepEqual(v.focus, { phase: "focus", endAt: 5000 });
  assert.equal(screenView({ ...base, focus: { plan: 25, phase: "focus", endAt: 0, left: 900 } }, 1000).focus, null); // paused
  assert.equal(screenView({ ...base, focus: { plan: 25, phase: "focus", endAt: 900, left: 0 } }, 1000).focus, null); // over
});

test("mmss", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(61_001), "1:02");
  assert.equal(mmss(-5), "0:00");
});
