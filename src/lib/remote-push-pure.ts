// Phone push notifications (roadmap 6.3): Web Push for the paired /remote app. Pure; tested in tests/remote-push.test.ts.
// Crypto: VAPID (RFC 8292, ES256 JWT) and aes128gcm payload encryption (RFC 8291 / RFC 8188) on node:crypto, no web-push package.
// Policy: fixed labels only (never item titles, email text, journal or memory), max 1 per kind per 2 min, quiet hours 23-08 Tallinn.
// Server glue: remote-push.ts; route: /api/remote/push; service worker: /remote/sw.js.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

// ---- What gets sent ---------------------------------------------------------

export type PushKind = "clip" | "spend" | "send" | "scheduled" | "published" | "failed" | "stop" | "night";
export type PushMessage = { title: string; body: string; url: string; tag: PushKind };
export const PUSH_GAP_MS = 2 * 60_000;

/** The whole payload: a fixed label per kind and a deep link into /remote. Only the count varies. */
export function pushLabel(kind: PushKind, n = 1): PushMessage {
  const many = n > 1;
  const m: Record<PushKind, [string, string, string]> = {
    clip: [many ? `${n} new clips to review` : "New clip to review", "Approve or reject it in Remote.", "r-appr"],
    spend: [many ? `${n} Higgsfield quotes ready` : "Higgsfield quote ready", "A spend is waiting for your approval.", "r-appr"],
    send: [many ? `${n} BUSINESS drafts ready` : "BUSINESS draft ready", "An email is waiting for your approval.", "r-appr"],
    scheduled: [many ? `${n} Shorts scheduled` : "Short scheduled", "It's set to go live on YouTube.", "r-queue"],
    published: [many ? `${n} Shorts published` : "Short published", "It's live on YouTube.", "r-queue"],
    failed: [many ? `${n} jobs failed` : "A job failed", "Check ORBIT on the PC to see why.", "r-queue"],
    stop: ["Stop-all is ON", "ORBIT is paused. Resume it from the PC.", "r-stop"],
    night: ["Night shift done", "See what ORBIT did while you slept.", "r-appr"], // night.ts sends its own counts (nightPush)
  };
  const [title, body, anchor] = m[kind];
  return { title, body, url: `/remote#${anchor}`, tag: kind };
}

/** Hour of the day in Tallinn (0-23), DST included. */
export const tallinnHour = (now: number) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tallinn", hour: "2-digit", hourCycle: "h23" }).format(now));
export const quietAt = (now: number) => { const h = tallinnHour(now); return h >= 23 || h < 8; };

export type Slot = { last: number; held: number };
export type GateResult = { slot: Slot; send: number; wakeAt?: number };

/** One event of `kind`: send now (with anything held), hold it for the next window, or drop it in quiet hours (failures never). */
export function gate(slot: Slot | undefined, kind: PushKind, now: number): GateResult {
  const s = slot ?? { last: -Infinity, held: 0 };
  if (kind !== "failed" && quietAt(now)) return { slot: { ...s, held: 0 }, send: 0 }; // dropped: Remote still lists what's waiting
  if (now - s.last >= PUSH_GAP_MS) return { slot: { last: now, held: 0 }, send: s.held + 1 };
  return { slot: { ...s, held: s.held + 1 }, send: 0, wakeAt: s.last + PUSH_GAP_MS };
}

/** The held events when their window opens: one coalesced push, unless quiet hours started meanwhile. */
export function flush(slot: Slot | undefined, kind: PushKind, now: number): GateResult {
  const s = slot ?? { last: -Infinity, held: 0 };
  if (!s.held || (kind !== "failed" && quietAt(now))) return { slot: { ...s, held: 0 }, send: 0 };
  return { slot: { last: now, held: 0 }, send: s.held };
}

// ---- Subscriptions and keys -----------------------------------------------

export type PushSub = { endpoint: string; p256dh: string; auth: string };
// Only real push services: a paired phone must not be able to make the PC POST to arbitrary (e.g. LAN) addresses.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
const b64 = (s: unknown, bytes: number) => typeof s === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(s) && Buffer.from(s, "base64url").length === bytes;

/** PushSubscription.toJSON() from the phone → stored subscription, or an error. */
export function parseSubscription(v: unknown): { ok: true; sub: PushSub } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "subscription must be an object" };
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  let u: URL;
  try { u = new URL(String(o.endpoint ?? "")); } catch { return { ok: false, error: "bad endpoint" }; }
  if (u.protocol !== "https:" || u.port || u.username || String(o.endpoint).length > 1024 || !PUSH_HOSTS.some((h) => h.test(u.hostname))) return { ok: false, error: "endpoint is not a known push service" };
  const k = o.keys;
  if (!b64(k?.p256dh, 65) || Buffer.from(k!.p256dh as string, "base64url")[0] !== 4) return { ok: false, error: "bad p256dh key" };
  if (!b64(k?.auth, 16)) return { ok: false, error: "bad auth secret" };
  return { ok: true, sub: { endpoint: u.href, p256dh: k!.p256dh as string, auth: k!.auth as string } };
}

/** A fresh VAPID key pair as base64url: public = 65-byte uncompressed P-256 point, private = 32-byte scalar. */
export function vapidKeys(): { publicKey: string; privateKey: string } {
  const e = createECDH("prime256v1");
  e.generateKeys();
  const d = e.getPrivateKey();
  return { publicKey: e.getPublicKey().toString("base64url"), privateKey: Buffer.concat([Buffer.alloc(32 - d.length), d]).toString("base64url") }; // JWK d is exactly 32 bytes
}

/** "" when the pair is usable, else the message Remote and the PC show. */
export function vapidProblem(pub: string | undefined, priv: string | undefined): string {
  if (!pub || !priv) return "Notifications are off: run npm run remote:vapid on the PC, put the two lines in .env.local and restart ORBIT.";
  try {
    if (!b64(priv, 32) || !b64(pub, 65)) throw new Error();
    const e = createECDH("prime256v1");
    e.setPrivateKey(Buffer.from(priv, "base64url"));
    if (!e.getPublicKey().equals(Buffer.from(pub, "base64url"))) throw new Error();
  } catch { return "Notifications are off: REMOTE_VAPID_PUBLIC/PRIVATE aren't a matching key pair. Run npm run remote:vapid again."; }
  return "";
}

/** RFC 8292 Authorization header: `vapid t=<ES256 JWT>, k=<public key>`. JWT lives 12 h (the max is 24 h). */
export function vapidAuth(endpoint: string, pub: string, priv: string, subject: string, now: number): string {
  const p = Buffer.from(pub, "base64url");
  const key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: priv, x: p.subarray(1, 33).toString("base64url"), y: p.subarray(33, 65).toString("base64url") } });
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${body}.${sig.toString("base64url")}, k=${pub}`;
}

/** RFC 8291 aes128gcm body for one subscription (single record). `salt`/`asPrivate` are for the RFC test vector only. */
export function encryptPayload(plain: Buffer, sub: Pick<PushSub, "p256dh" | "auth">, t: { salt?: Buffer; asPrivate?: Buffer } = {}): Buffer {
  if (plain.length > 3993) throw new Error("push payload over 3993 bytes"); // 4096 record - 16 tag - 1 delimiter - 86 header
  const ua = Buffer.from(sub.p256dh, "base64url");
  const as = createECDH("prime256v1");
  if (t.asPrivate) as.setPrivateKey(t.asPrivate); else as.generateKeys();
  const asPub = as.getPublicKey();
  const salt = t.salt ?? randomBytes(16);
  const hk = (ikm: Buffer, s: Buffer, info: Buffer, len: number) => Buffer.from(hkdfSync("sha256", ikm, s, info, len));
  const ikm = hk(as.computeSecret(ua), Buffer.from(sub.auth, "base64url"), Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub]), 32);
  const cek = hk(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hk(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, ct]);
}
