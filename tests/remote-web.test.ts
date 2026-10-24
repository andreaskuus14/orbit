import { test } from "node:test";
import assert from "node:assert/strict";
import { NonceCache, parseCommand } from "../src/lib/remote-pure.ts";
import { actionFor, approvalId, clipStamp, cookieOptions, deviceName, echoProblem, ledgerData, parseEcho, quoteStamp, secretProblem, stopProblem, takeRate, type Approval } from "../src/lib/remote-web-pure.ts";

const SECRET = "k".repeat(32);
const cmd = (o: object) => {
  const r = parseCommand(JSON.stringify({ nonce: `n-${Math.random().toString(36).slice(2)}-abcdefgh`, ...o }), new NonceCache());
  if (!r.ok) throw new Error(r.error);
  return r.cmd;
};
const ID = "123e4567-e89b-42d3-a456-426614174000";

test("secretProblem: unset and short secrets disable the remote", () => {
  assert.match(secretProblem(undefined), /set REMOTE_SECRET/);
  assert.match(secretProblem(""), /set REMOTE_SECRET/);
  assert.match(secretProblem("x".repeat(31)), /32 bytes/);
  assert.equal(secretProblem("x".repeat(32)), "");
  assert.equal(secretProblem("é".repeat(16)), ""); // bytes, not characters
});

test("cookieOptions: HttpOnly, Strict, scoped to /api/remote, Secure only on https", () => {
  const c = cookieOptions(true);
  assert.deepEqual(c, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/remote", maxAge: 30 * 86_400 });
  assert.equal(cookieOptions(false).secure, false);
});

test("takeRate: sliding window", () => {
  let hits: number[] = [];
  for (let i = 0; i < 3; i++) { const r = takeRate(hits, 1000 + i, 3, 100); assert.equal(r.ok, true); hits = r.hits; }
  assert.equal(takeRate(hits, 1050, 3, 100).ok, false);
  const later = takeRate(hits, 1100, 3, 100); // the first hit (1000) has left the window
  assert.deepEqual([later.ok, later.hits], [true, [1001, 1002, 1100]]);
});

test("actionFor: every command type maps; navigate is not offered", () => {
  assert.equal(actionFor(cmd({ type: "status" })), "status");
  assert.equal(actionFor(cmd({ type: "approval.list" })), "approvals");
  assert.equal(actionFor(cmd({ type: "approve", id: ID })), "approve");
  assert.equal(actionFor(cmd({ type: "reject", id: ID })), "reject");
  assert.equal(actionFor(cmd({ type: "stopAll" })), "stopAll");
  assert.equal(actionFor(cmd({ type: "core.ask", text: "hi" })), "ask");
  assert.equal(actionFor(cmd({ type: "navigate", panel: "studio" })), "unsupported");
});

test("approvalId: a stable uuid per key and secret that parseCommand accepts", () => {
  const a = approvalId("clip:abc123-0a1b2c/clip-1", SECRET);
  assert.equal(a, approvalId("clip:abc123-0a1b2c/clip-1", SECRET));
  assert.notEqual(a, approvalId("clip:abc123-0a1b2c/clip-2", SECRET));
  assert.notEqual(a, approvalId("clip:abc123-0a1b2c/clip-1", "z".repeat(32)));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(cmd({ type: "approve", id: a }).type, "approve");
});

test("parseEcho: approve/reject need an item echo, stopAll needs {on}, others take none", () => {
  const ap = cmd({ type: "approve", id: ID });
  assert.deepEqual(parseEcho(ap, { kind: "spend", credits: 12.5 }), { ok: true, echo: { kind: "spend", credits: 12.5, seen: undefined } });
  for (const bad of [undefined, null, [], {}, { kind: "money" }, { kind: "spend", credits: "12" }, { kind: "spend", credits: -1 }, { kind: "spend", credits: Infinity }, { kind: "clip", extra: 1 }, { kind: "send", seen: "x".repeat(129) }])
    assert.equal(parseEcho(ap, bad).ok, false, JSON.stringify(bad));
  const stop = cmd({ type: "stopAll" });
  assert.deepEqual(parseEcho(stop, { on: false }), { ok: true, echo: { on: false } });
  for (const bad of [undefined, {}, { on: "true" }, { on: true, kind: "clip" }]) assert.equal(parseEcho(stop, bad).ok, false);
  assert.deepEqual(parseEcho(cmd({ type: "status" }), undefined), { ok: true, echo: null });
  assert.equal(parseEcho(cmd({ type: "core.ask", text: "x" }), { on: true }).ok, false);
});

const Q = quoteStamp({ at: "2026-10-24T10:00:00.000Z", fingerprint: "abc123" });
const spend: Approval = { id: ID, key: "spend:s1", kind: "spend", title: "T", detail: "", credits: 40, seen: Q };
const sendItem: Approval = { id: ID, key: "send:p", kind: "send", title: "Cafe", detail: "", to: "a@b.co", message: "Hi", seen: "2026-10-24T10:00:00.123+00:00" };
const C = { title: "Play", thumb: "clips/j/t.jpg", video: "clips/j/v.mp4", start: 1, end: 30, status: "ready" };
const clip: Approval = { id: ID, key: "clip:j/clip-1", kind: "clip", title: "Play", detail: "", seen: clipStamp(C), thumb: true };

test("echoProblem: only items waiting now, with the exact kind and version", () => {
  assert.match(echoProblem(undefined, { kind: "clip", seen: clip.seen }, "approve"), /no longer waiting/);
  assert.match(echoProblem(clip, { kind: "spend", credits: 40, seen: clip.seen }, "approve"), /changed/);
  assert.match(echoProblem(clip, { on: true }, "approve"), /changed/);
  assert.match(echoProblem(clip, null, "approve"), /changed/);
});

test("echoProblem: clips need the current stamp, and a thumbnail to approve", () => {
  assert.equal(echoProblem(clip, { kind: "clip", seen: clip.seen }, "approve"), "");
  assert.equal(echoProblem(clip, { kind: "clip", seen: clip.seen }, "reject"), "");
  assert.match(echoProblem(clip, { kind: "clip" }, "approve"), /changed since you saw it/);
  assert.match(echoProblem(clip, { kind: "clip", seen: clipStamp({ ...C, title: "Renamed" }) }, "approve"), /changed since you saw it/);
  assert.match(echoProblem({ ...clip, thumb: false }, { kind: "clip", seen: clip.seen }, "approve"), /Open it on the PC/);
  assert.equal(echoProblem({ ...clip, thumb: false }, { kind: "clip", seen: clip.seen }, "reject"), "");
});

test("clipStamp: changes with what the owner sees", () => {
  const base = clipStamp(C);
  assert.match(base, /^[0-9a-f]{16}$/);
  assert.equal(clipStamp({ ...C }), base);
  for (const ch of [{ title: "x" }, { thumb: "clips/j/t2.jpg" }, { video: "clips/j/v2.mp4" }, { start: 2 }, { end: 31 }, { status: "approved" }])
    assert.notEqual(clipStamp({ ...C, ...ch }), base, JSON.stringify(ch));
});

test("echoProblem: spends need the exact credits and the same quote (time + script fingerprint)", () => {
  assert.equal(echoProblem(spend, { kind: "spend", credits: 40, seen: Q }, "approve"), "");
  assert.match(echoProblem(spend, { kind: "spend", credits: 39.99, seen: Q }, "approve"), /now 40 credits/);
  assert.match(echoProblem(spend, { kind: "spend", seen: Q }, "approve"), /now 40 credits/);
  assert.match(echoProblem(spend, { kind: "spend", credits: 40 }, "approve"), /changed since you saw it/);
  assert.match(echoProblem(spend, { kind: "spend", credits: 40, seen: quoteStamp({ at: "2026-10-24T10:00:00.000Z", fingerprint: "zzz" }) }, "approve"), /changed since you saw it/);
  assert.match(echoProblem({ ...spend, credits: undefined }, { kind: "spend", seen: Q }, "approve"), /credits/); // no quote, never approvable
  assert.match(echoProblem(spend, { kind: "spend", credits: 40, seen: Q }, "reject"), /Only clips/);
});

test("echoProblem: sends need the exact draft version", () => {
  assert.equal(echoProblem(sendItem, { kind: "send", seen: sendItem.seen }, "approve"), "");
  assert.match(echoProblem(sendItem, { kind: "send", seen: "2026-10-24T09:00:00Z" }, "approve"), /draft changed/);
  assert.match(echoProblem(sendItem, { kind: "send" }, "approve"), /draft changed/);
  assert.match(echoProblem({ ...sendItem, seen: "" }, { kind: "send", seen: "" }, "approve"), /draft changed/);
  assert.match(echoProblem(sendItem, { kind: "send", seen: sendItem.seen }, "reject"), /Only clips/);
});

test("stopProblem: the phone can only switch Stop-all on", () => {
  assert.equal(stopProblem(false, { on: false }), "");
  assert.match(stopProblem(true, { on: true }), /Resume ORBIT from the PC/);
  assert.match(stopProblem(true, { on: false }), /Resume ORBIT from the PC/);
  assert.match(stopProblem(false, { on: true }), /changed on another screen/);
  assert.match(stopProblem(false, null), /echo/);
  assert.match(stopProblem(false, { kind: "clip" }), /echo/);
});

test("ledgerData: type, outcome and device only", () => {
  assert.deepEqual(ledgerData(cmd({ type: "core.ask", text: "secret plans" }), true, "d1"), { command: "core.ask", ok: true, device: "d1" });
  assert.deepEqual(ledgerData(null, false, "d1"), { command: "invalid", ok: false, device: "d1" });
});

test("deviceName: printable, short, default iPhone", () => {
  assert.equal(deviceName("Andreas's iPhone <script>"), "Andreas's iPhone script");
  assert.equal(deviceName(""), "iPhone");
  assert.equal(deviceName(42), "iPhone");
  assert.equal(deviceName("x".repeat(80)).length, 40);
});
