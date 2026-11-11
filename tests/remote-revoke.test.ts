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

test("pairView: the PC shows a code spent by PAIR_MAX_FAILS_ALL wrong tries as locked, not usable", async () => {
  const { pairView, PAIR_MAX_FAILS_ALL } = await import("../src/lib/remote-pure.ts");
  const p = makePairCode(() => 42, 0);
  assert.equal(pairView(p, 1)?.code, p.code);
  assert.deepEqual(pairView({ ...p, fails: PAIR_MAX_FAILS_ALL }, 1), { locked: true, expiresAt: p.expiresAt });
  assert.equal(pairView({ ...p, used: true }, 1), null);
  assert.equal(pairView(p, p.expiresAt), null);
  assert.equal(pairView(null, 1), null);
});

test("Fable #551: the PC re-reads the pairing while a code shows, so the lock appears without a reload", async () => {
  const { pairRefetch, PAIR_POLL_MS } = await import("../src/lib/pair-poll-pure.ts");
  const live = { code: "123456", expiresAt: 100_000 };
  assert.equal(pairRefetch(live, 10_000, 10_000 - PAIR_POLL_MS), true);
  assert.equal(pairRefetch(live, 10_000, 9_000), false);
  assert.equal(pairRefetch({ locked: true, expiresAt: 100_000 }, 10_000, 0), false, "locked: nothing left to watch until it expires");
  assert.equal(pairRefetch(live, 100_000, 99_999), true, "expired: read once more");
  assert.equal(pairRefetch(null, 10_000, 0), false);
});
