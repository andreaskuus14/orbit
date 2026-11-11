// J03: a revoked phone's token can't reach a command; expired/forged tokens and replayed nonces neither. Fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceForToken, makePairCode, NonceCache, parseCommand, signToken, verifyPair } from "../src/lib/remote-pure.ts";

const SECRET = "t".repeat(32), T0 = 1_800_000_000_000, DAY = 86_400_000;
const phone = { id: "a".repeat(24), name: "Test phone" }, other = { id: "b".repeat(24), name: "Other" };
const tok = signToken({ deviceId: phone.id, issuedAt: T0, exp: T0 + 30 * DAY }, SECRET);

test("revoke: a validly signed, unexpired token stops matching once its device is removed", () => {
  assert.equal(deviceForToken(tok, SECRET, T0 + 1, [phone, other]), phone);
  assert.equal(deviceForToken(tok, SECRET, T0 + 1, [other]), null); // revoked
  assert.equal(deviceForToken(tok, SECRET, T0 + 1, []), null);
  // re-pairing the same phone makes a new device id; the old token stays dead
  assert.equal(deviceForToken(tok, SECRET, T0 + 2, [{ id: "c".repeat(24), name: "Test phone" }]), null);
});

test("expiry, forgery and secret rotation all refuse a listed device", () => {
  assert.equal(deviceForToken(tok, SECRET, T0 + 30 * DAY, [phone]), null);
  assert.equal(deviceForToken(tok, "u".repeat(32), T0 + 1, [phone]), null);
  assert.equal(deviceForToken(tok.slice(0, -2) + "xx", SECRET, T0 + 1, [phone]), null);
  assert.equal(deviceForToken(undefined, SECRET, T0 + 1, [phone]), null);
});

test("replay: the same signed command body is accepted once per nonce", () => {
  const c = new NonceCache(), body = JSON.stringify({ type: "stopAll", nonce: "j03-replay-000001" });
  assert.equal(parseCommand(body, c).ok, true);
  assert.equal(parseCommand(body, c).ok, false);
});

test("pair code: one success, then used; expired codes never pair", () => {
  const p = makePairCode(() => 123456, T0);
  const r = verifyPair(p, "123456", T0 + 1);
  assert.ok(r.ok);
  assert.equal(verifyPair(r.pair, "123456", T0 + 2).ok, false);
  assert.equal(verifyPair(p, "123456", p.expiresAt).ok, false);
});
