import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { encryptPayload, flush, gate, parseSubscription, pushFor, pushLabel, PUSH_GAP_MS, quietAt, vapidAuth, vapidKeys, vapidProblem } from "../src/lib/remote-push-pure.ts";

test("aes128gcm matches the RFC 8291 Appendix A test vector", () => {
  const body = encryptPayload(Buffer.from("When I grow up, I want to be a watermelon"), {
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
  }, { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), asPrivate: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url") });
  assert.equal(body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("random encryption uses a fresh salt and key each time; oversize payloads refused", () => {
  const ua = vapidKeys().publicKey;
  const sub = { p256dh: ua, auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  const a = encryptPayload(Buffer.from("x"), sub), b = encryptPayload(Buffer.from("x"), sub);
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
  assert.equal(a.length, 16 + 4 + 1 + 65 + 2 + 16);
  assert.throws(() => encryptPayload(Buffer.alloc(4000), sub));
});

test("VAPID header is an RFC 8292 ES256 JWT for the push service origin", () => {
  const k = vapidKeys();
  assert.equal(vapidProblem(k.publicKey, k.privateKey), "");
  const now = Date.UTC(2026, 9, 25, 12);
  const h = vapidAuth("https://web.push.apple.com/QGuQyavXutnMH/abc", k.publicKey, k.privateKey, "mailto:me@example.com", now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
  assert.ok(m);
  assert.equal(m[4], k.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(m[1], "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(m[2], "base64url").toString()), { aud: "https://web.push.apple.com", exp: now / 1000 + 43200, sub: "mailto:me@example.com" });
  const p = Buffer.from(k.publicKey, "base64url");
  const pub = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: p.subarray(1, 33).toString("base64url"), y: p.subarray(33).toString("base64url") } });
  assert.ok(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url")));
});

test("vapidProblem: missing or mismatched keys turn the feature off", () => {
  const a = vapidKeys(), b = vapidKeys();
  assert.match(vapidProblem("", ""), /remote:vapid/);
  assert.match(vapidProblem(a.publicKey, b.privateKey), /matching/);
  assert.match(vapidProblem(a.publicKey, "short"), /matching/);
});

test("parseSubscription accepts real push services only", () => {
  const keys = { p256dh: vapidKeys().publicKey, auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  assert.ok(parseSubscription({ endpoint: "https://web.push.apple.com/abc", keys }).ok);
  assert.ok(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }).ok);
  for (const endpoint of ["http://web.push.apple.com/a", "https://192.168.1.1/a", "https://web.push.apple.com.evil.io/a", "https://web.push.apple.com:8443/a", "https://localhost/a", "nope"])
    assert.equal(parseSubscription({ endpoint, keys }).ok, false, endpoint);
  assert.equal(parseSubscription({ endpoint: "https://web.push.apple.com/a", keys: { ...keys, auth: "AAAA" } }).ok, false);
  assert.equal(parseSubscription({ endpoint: "https://web.push.apple.com/a", keys: { ...keys, p256dh: "BTBZMqHH6r4Tts7J_aSIgg" } }).ok, false);
  assert.equal(parseSubscription(null).ok, false);
});

test("quiet hours are 23:00-08:00 Tallinn, summer and winter", () => {
  assert.equal(quietAt(Date.UTC(2026, 6, 1, 12)), false); // 15:00 EEST
  assert.equal(quietAt(Date.UTC(2026, 6, 1, 20)), true); // 23:00 EEST
  assert.equal(quietAt(Date.UTC(2026, 0, 15, 20, 59)), false); // 22:59 EET
  assert.equal(quietAt(Date.UTC(2026, 0, 15, 21)), true); // 23:00 EET
  assert.equal(quietAt(Date.UTC(2026, 0, 15, 5, 59)), true); // 07:59 EET
  assert.equal(quietAt(Date.UTC(2026, 0, 15, 6)), false); // 08:00 EET
});

test("gate: one per kind per 2 min, the rest coalesced; quiet hours drop all but failures", () => {
  const day = Date.UTC(2026, 6, 1, 12);
  let r = gate(undefined, "clip", day);
  assert.equal(r.send, 1);
  r = gate(r.slot, "clip", day + 1000);
  assert.deepEqual([r.send, r.wakeAt], [0, day + PUSH_GAP_MS]);
  r = gate(r.slot, "clip", day + 2000);
  assert.equal(r.slot.held, 2);
  const f = flush(r.slot, "clip", day + PUSH_GAP_MS);
  assert.equal(f.send, 2);
  assert.equal(pushLabel("clip", f.send).title, "2 new clips to review");
  assert.equal(flush(f.slot, "clip", day + PUSH_GAP_MS * 2).send, 0);
  r = gate(f.slot, "clip", day + PUSH_GAP_MS * 2 + 1);
  assert.equal(r.send, 1);
  const night = Date.UTC(2026, 6, 1, 22); // 01:00 Tallinn
  assert.equal(gate(undefined, "stop", night).send, 0);
  assert.equal(gate(undefined, "failed", night).send, 1);
  assert.equal(flush({ last: day, held: 3 }, "spend", night).send, 0);
});

test("labels carry no item content: fixed text and a /remote deep link", () => {
  for (const k of ["clip", "spend", "send", "scheduled", "published", "failed", "stop", "call", "invoice"] as const) {
    const m = pushLabel(k, 3);
    assert.match(m.url, /^\/remote#r-[a-z]+$/);
    assert.deepEqual(Object.keys(m).sort(), ["body", "tag", "title", "url"]);
  }
});

test("pushFor: the habit label in Estonian for an Estonian phone; other kinds and English unchanged", () => {
  const h = { ...pushLabel("habit"), url: "/remote?habit=x#r-habit", habit: "x" };
  assert.equal(pushFor(h, "et").title, "Harjumuse aeg");
  assert.equal(pushFor(h, "et").habit, "x");
  assert.equal(pushFor(h, "en"), h);
  assert.equal(pushFor(h, undefined), h);
  const c = pushLabel("clip");
  assert.equal(pushFor(c, "et"), c);
});
