import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconSecs, coarseUa, expiryFor, ipPrefix, linkToken, MAX_DAYS, MAX_SECS, parseToken, rateOk, tokenState, viewerHtml, type PitchLink } from "../src/lib/pitch-links-pure.ts";

const key = Buffer.alloc(32, 7), now = 1_800_000_000;
const link = (o: Partial<PitchLink> = {}): PitchLink => ({ id: "abcdefghijkl", contractId: "c1", n: 2, title: "T", nonce: "nonce-1", at: "", exp: now + 3600, notify: true, views: [], ...o });

test("token: valid, tampered, wrong key, wrong nonce, malformed", () => {
  const l = link(), t = linkToken(key, l);
  assert.equal(tokenState(key, t, l, now), "ok");
  assert.ok(parseToken(t));
  const last = t.at(-1) === "A" ? "B" : "A";
  assert.equal(tokenState(key, t.slice(0, -1) + last, l, now), "bad");
  assert.equal(tokenState(Buffer.alloc(32, 8), t, l, now), "bad");
  assert.equal(tokenState(key, t, link({ nonce: "other" }), now), "bad"); // a recreated link gets a new nonce
  assert.equal(tokenState(key, t.replace(String(l.exp), String(l.exp + 999)), l, now), "bad"); // extending the expiry breaks the sig
  for (const x of ["", "a.b.c", `${t}.x`, null, 5, "x".repeat(200)]) assert.equal(tokenState(key, x, l, now), "bad");
  assert.equal(tokenState(key, t, undefined, now), "bad");
});

test("expiry and revoke", () => {
  const l = link(), t = linkToken(key, l);
  assert.equal(tokenState(key, t, l, l.exp - 1), "ok");
  assert.equal(tokenState(key, t, l, l.exp), "expired");
  assert.equal(tokenState(key, t, { ...l, revoked: "2026-11-11T00:00:00Z" }, now), "revoked");
  assert.equal(expiryFor(undefined, now), now + 14 * 86400);
  assert.equal(expiryFor(9999, now), now + MAX_DAYS * 86400);
  assert.equal(expiryFor(0, now), now + 86400);
  assert.equal(expiryFor(Number.NaN, now), now + 14 * 86400);
});

test("beacon math: monotonic, bounded by wall clock and cap, junk ignored", () => {
  const opened = 1_000_000;
  assert.equal(beaconSecs(0, 30, opened, opened + 30_000), 30);
  assert.equal(beaconSecs(0, 500, opened, opened + 30_000), 35); // can't claim more than elapsed + 5 s slack
  assert.equal(beaconSecs(40, 10, opened, opened + 60_000), 40); // never goes down
  assert.equal(beaconSecs(0, "99", opened, opened + 60_000), 0);
  assert.equal(beaconSecs(0, -5, opened, opened + 60_000), 0);
  assert.equal(beaconSecs(0, Infinity, opened, opened + 60_000), 0);
  assert.equal(beaconSecs(0, 1e9, opened, opened + 1e10), MAX_SECS);
  assert.equal(beaconSecs(0, 12.9, opened, opened + 60_000), 12);
});

test("rate limit: fixed window per key", () => {
  const m = new Map<string, { start: number; n: number }>();
  for (let i = 0; i < 3; i++) assert.ok(rateOk(m, "a", 1000, 3, 60_000));
  assert.equal(rateOk(m, "a", 1000, 3, 60_000), false);
  assert.ok(rateOk(m, "b", 1000, 3, 60_000)); // other key unaffected
  assert.ok(rateOk(m, "a", 61_000, 3, 60_000)); // new window
});

test("privacy: at most 3 octets, coarse user agent", () => {
  assert.equal(ipPrefix("203.0.113.77, 10.0.0.1"), "203.0.113");
  assert.equal(ipPrefix("::ffff:198.51.100.9"), "198.51.100");
  assert.equal(ipPrefix("2001:db8:abcd:12::1"), "2001:db8:abcd");
  assert.equal(ipPrefix(null), "");
  assert.equal(ipPrefix("garbage"), "");
  assert.equal(coarseUa("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(coarseUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1"), "Safari on iOS");
  assert.equal(coarseUa("Slackbot-LinkExpanding 1.0"), "Bot or link preview");
});

test("viewer page escapes the document", () => {
  const h = viewerHtml("<x>", "a & <script>alert(1)</script>", "tok", "v1", "n");
  assert.ok(!h.includes("<script>alert"));
  assert.ok(h.includes("&#60;script&#62;"));
  assert.ok(h.includes('nonce="n"'));
});

test("pitch key is domain-separated; previews and the logged notice", async () => {
  const { pitchKey, isPreviewUa } = await import("../src/lib/pitch-links-pure.ts");
  assert.notDeepEqual(pitchKey(key), key);
  for (const u of ["WhatsApp/2.23.20", "Microsoft Office Outlook SafeLinks", "Slackbot-LinkExpanding", "Mozilla/5.0 (compatible; Discordbot/2.0)", "TelegramBot (like TwitterBot)"]) assert.ok(isPreviewUa(u), u);
  assert.ok(!isPreviewUa("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36"));
  assert.ok(viewerHtml("t", "x", "tok", "v", "n").includes("Opens of this link are logged."));
  assert.ok(!viewerHtml("t", "x", "tok", "", "n").includes("sendBeacon")); // not a view: no beacon
});

test("scanner list: fetchers skipped, in-app browsers counted", async () => {
  const { isPreviewUa } = await import("../src/lib/pitch-links-pure.ts");
  for (const u of ["LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0", "Slack-ImgProxy (+https://api.slack.com/robots)", "Skype URL Preview", "Mozilla/4.0 (compatible; ms-office; MSOffice 16)", "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.1)", "Mozilla/5.0 Microsoft Office Outlook SafeLinks"]) assert.ok(isPreviewUa(u), u);
  for (const u of [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.30",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Telegram-Android/10.14",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Outlook-iOS/4.2",
  ]) assert.ok(!isPreviewUa(u), u);
});
