import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomInt } from "node:crypto";
import {
  makePairCode, MAX_ASK_CHARS, NonceCache, PAIR_TTL_MS, parseCommand, REMOTE_PANELS, signToken, verifyPair, verifyToken,
} from "../src/lib/remote-pure.ts";

const SECRET = "s".repeat(32);
const T0 = 1_800_000_000_000;
const err = (r: { ok: boolean; error?: string }) => r.error;

test("makePairCode: 6 digits, zero-padded, 2-minute expiry", () => {
  const p = makePairCode(() => 42, T0);
  assert.deepEqual(p, { code: "000042", expiresAt: T0 + 120_000, fails: 0, used: false });
  assert.match(makePairCode(randomInt).code, /^\d{6}$/);
  assert.throws(() => makePairCode(() => 1_000_000), /rand/);
  assert.throws(() => makePairCode(() => 0.5), /rand/);
});

test("verifyPair: success consumes the code", () => {
  const p = makePairCode(() => 123456, T0);
  const r = verifyPair(p, "123456", T0 + 1000);
  assert.equal(r.ok, true);
  assert.equal(verifyPair(r.pair, "123456", T0 + 2000).ok, false);
  assert.equal((verifyPair(r.pair, "123456", T0) as { reason: string }).reason, "used");
});

test("verifyPair: expiry", () => {
  const p = makePairCode(() => 123456, T0);
  assert.equal(verifyPair(p, "123456", T0 + PAIR_TTL_MS - 1).ok, true);
  const r = verifyPair(p, "123456", T0 + PAIR_TTL_MS);
  assert.deepEqual([r.ok, (r as { reason: string }).reason], [false, "expired"]);
});

test("verifyPair: locks after 5 wrong tries, even for the right code", () => {
  let p = makePairCode(() => 111111, T0);
  const reasons: string[] = [];
  for (const guess of ["000000", "12345", "abcdef", 111111, "1111111"]) {
    const r = verifyPair(p, guess, T0);
    assert.equal(r.ok, false);
    reasons.push((r as { reason: string }).reason);
    p = r.pair;
  }
  assert.deepEqual(reasons, ["wrong", "wrong", "wrong", "wrong", "locked"]);
  const r = verifyPair(p, "111111", T0);
  assert.deepEqual([r.ok, (r as { reason: string }).reason], [false, "locked"]);
});

test("verifyPair: 4 wrong then right still works", () => {
  let p = makePairCode(() => 222222, T0);
  for (let i = 0; i < 4; i++) p = verifyPair(p, "000000", T0).pair;
  assert.equal(verifyPair(p, "222222", T0).ok, true);
});

const payload = { deviceId: "iphone-1", issuedAt: T0, exp: T0 + 3600_000 };

test("token round-trip", () => {
  const t = signToken(payload, SECRET);
  assert.deepEqual(verifyToken(t, SECRET, T0 + 1), { ok: true, payload });
});

test("token: tampering is rejected", () => {
  const t = signToken(payload, SECRET);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload, deviceId: "attacker" })).toString("base64url");
  assert.deepEqual(verifyToken(`${forged}.${sig}`, SECRET, T0), { ok: false, error: "bad signature" });
  const longer = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp * 2 })).toString("base64url");
  assert.equal(verifyToken(`${longer}.${sig}`, SECRET, T0).ok, false);
  const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
  assert.equal(verifyToken(`${body}.${flipped}`, SECRET, T0).ok, false);
  assert.equal(verifyToken(`${body}.${sig.slice(0, -2)}`, SECRET, T0).ok, false);
  assert.equal(verifyToken(t, "x".repeat(32), T0).ok, false);
  for (const bad of ["", "a.b.c", body, `${body}.`, `${body}.${sig}=`, 42, null, `${body}.${sig}.${sig}`]) {
    assert.equal(verifyToken(bad, SECRET, T0).ok, false, String(bad));
  }
});

test("token: correctly signed but malformed payloads are rejected", () => {
  const sign = (o: unknown) => {
    const b = Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b}.${createHmac("sha256", SECRET).update(b).digest("base64url")}`;
  };
  assert.equal(err(verifyToken(sign({ ...payload, admin: true }), SECRET, T0)), "malformed");
  assert.equal(err(verifyToken(sign({ ...payload, exp: "never" }), SECRET, T0)), "malformed");
  assert.equal(err(verifyToken(sign({ ...payload, deviceId: "../x" }), SECRET, T0)), "malformed");
  assert.equal(err(verifyToken(sign([payload]), SECRET, T0)), "malformed");
});

test("token: expiry and future issue", () => {
  const t = signToken(payload, SECRET);
  assert.deepEqual(verifyToken(t, SECRET, payload.exp), { ok: false, error: "expired" });
  assert.equal(verifyToken(t, SECRET, payload.exp - 1).ok, true);
  assert.equal(err(verifyToken(t, SECRET, T0 - 120_000)), "issued in the future");
});

test("token: secret is required and must be long", () => {
  assert.throws(() => signToken(payload, "short"), /secret/);
  assert.throws(() => verifyToken("a.b", "", T0), /secret/);
  assert.throws(() => signToken({ ...payload, exp: T0 - 1 }, SECRET), /payload/);
});

let n = 0;
const nonce = () => `nonce-${String(++n).padStart(12, "0")}`;
const cmd = (o: Record<string, unknown>) => JSON.stringify({ nonce: nonce(), ...o });
const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("parseCommand accepts every command type", () => {
  const c = new NonceCache();
  for (const panel of REMOTE_PANELS) assert.equal(parseCommand(cmd({ type: "navigate", panel }), c).ok, true);
  for (const type of ["approval.list", "stopAll", "status", "brief"]) assert.equal(parseCommand(cmd({ type }), c).ok, true);
  const ask = parseCommand(cmd({ type: "core.ask", text: "hi" }), c);
  assert.ok(ask.ok && ask.cmd.type === "core.ask" && ask.cmd.text === "hi" && !("lang" in ask.cmd));
  const et = parseCommand(cmd({ type: "core.ask", text: "tere", lang: "et" }), c); // UI language switch: CORE answers in Estonian
  assert.ok(et.ok && et.cmd.type === "core.ask" && et.cmd.lang === "et");
  const en = parseCommand(cmd({ type: "core.ask", text: "hi", lang: "en" }), c);
  assert.ok(en.ok && !("lang" in en.cmd));
  const rej = parseCommand(cmd({ type: "reject", id: UUID }), c);
  assert.ok(rej.ok && !("requiresOwnerConfirm" in rej.cmd));
});

test("parseCommand: approve is marked requiresOwnerConfirm", () => {
  const r = parseCommand(cmd({ type: "approve", id: UUID.toUpperCase() }), new NonceCache());
  assert.ok(r.ok);
  assert.deepEqual({ ...r.cmd, nonce: "" }, { type: "approve", nonce: "", id: UUID, requiresOwnerConfirm: true });
  // The client cannot set (or unset) the flag itself.
  assert.equal(parseCommand(cmd({ type: "approve", id: UUID, requiresOwnerConfirm: false }), new NonceCache()).ok, false);
});

test("parseCommand rejects bad input", () => {
  const c = new NonceCache();
  const bad: [unknown, RegExp][] = [
    [cmd({ type: "navigate", panel: "nope" }), /panel/],
    [cmd({ type: "navigate", panel: "core", extra: 1 }), /unknown field: extra/],
    [cmd({ type: "status", panel: "core" }), /unknown field/],
    [cmd({ type: "spend", amount: 5 }), /unknown command/],
    [cmd({ type: "send", to: "x" }), /unknown command/],
    [cmd({ type: "__proto__" }), /unknown command/],
    [cmd({ type: "constructor" }), /unknown command/],
    [cmd({}), /unknown command/],
    [cmd({ type: "core.ask", text: "" }), /text required/],
    [cmd({ type: "core.ask", text: 5 }), /text required/],
    [cmd({ type: "core.ask", text: "hi", lang: "de" }), /bad lang/],
    [cmd({ type: "core.ask", text: "a".repeat(MAX_ASK_CHARS + 1) }), /2000/],
    [cmd({ type: "approve", id: "not-a-uuid" }), /uuid/],
    [cmd({ type: "reject" }), /uuid/],
    [JSON.stringify({ type: "status" }), /nonce/],
    [JSON.stringify({ type: "status", nonce: "short" }), /nonce/],
    [JSON.stringify({ type: "status", nonce: 12345678901234567 }), /nonce/],
    ["{not json", /invalid JSON/],
    ["[]", /object/],
    ["null", /object/],
    [{ type: "status" }, /JSON string/],
    [JSON.stringify({ type: "core.ask", nonce: nonce(), text: "a".repeat(9000) }), /8 KB/],
  ];
  for (const [input, err] of bad) {
    const r = parseCommand(input, c);
    assert.ok(!r.ok && err.test(r.error), `${String(input).slice(0, 60)} -> ${JSON.stringify(r)}`);
  }
  assert.equal(parseCommand(cmd({ type: "core.ask", text: "a".repeat(MAX_ASK_CHARS) }), c).ok, true);
});

test("parseCommand: 8 KB limit counts bytes, not chars", () => {
  // 2000 chars of 3-byte UTF-8 is ~6 KB: inside both limits.
  assert.equal(parseCommand(cmd({ type: "core.ask", text: "€".repeat(MAX_ASK_CHARS) }), new NonceCache()).ok, true);
  const padded = JSON.stringify({ type: "status", nonce: nonce() }) + " ".repeat(8 * 1024);
  assert.equal(parseCommand(padded, new NonceCache()).ok, false);
});

test("parseCommand: replayed nonces are rejected; failed commands do not burn the nonce", () => {
  const c = new NonceCache();
  const s = JSON.stringify({ type: "status", nonce: "replay-nonce-0001" });
  assert.equal(parseCommand(s, c).ok, true);
  const r = parseCommand(s, c);
  assert.ok(!r.ok && r.error === "replayed nonce");
  // Same nonce on another command type is still a replay.
  assert.equal(parseCommand(JSON.stringify({ type: "stopAll", nonce: "replay-nonce-0001" }), c).ok, false);
  const badThenGood = JSON.stringify({ type: "navigate", nonce: "replay-nonce-0002", panel: "nope" });
  assert.equal(parseCommand(badThenGood, c).ok, false);
  assert.equal(parseCommand(JSON.stringify({ type: "status", nonce: "replay-nonce-0002" }), c).ok, true);
});

test("NonceCache keeps only the last 500", () => {
  const c = new NonceCache();
  for (let i = 0; i < 501; i++) c.add(`n${i}`);
  assert.equal(c.size, 500);
  assert.equal(c.has("n0"), false);
  assert.equal(c.has("n1"), true);
  assert.equal(c.has("n500"), true);
  const small = new NonceCache(2);
  small.add("a"); small.add("b"); small.add("a"); small.add("c"); // re-adding "a" makes it newest
  assert.deepEqual([small.has("a"), small.has("b"), small.has("c")], [true, false, true]);
});
