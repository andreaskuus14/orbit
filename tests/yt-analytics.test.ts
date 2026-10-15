import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authUrl, fillDays, isVideoId, loopbackOrigin, parseRange, parseTable, periods, pkceChallenge, randomToken, reportUrl, sameSecret,
  totalsFrom, trafficLabel,
} from "../src/lib/yt-analytics-pure.ts";

const table = {
  columnHeaders: [{ name: "day" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "subscribersGained" }],
  rows: [["2026-10-01", 100, 50, 30, 2], ["2026-10-03", 300, 150, 60, 1]],
};

test("parseTable keys rows by column name and tolerates empty reports", () => {
  assert.deepEqual(parseTable(table)[1], { day: "2026-10-03", views: 300, estimatedMinutesWatched: 150, averageViewDuration: 60, subscribersGained: 1 });
  assert.deepEqual(parseTable({ columnHeaders: [{ name: "views" }] }), []); // no `rows` key when there's no data
  assert.deepEqual(parseTable(null), []);
});

test("fillDays covers every day inclusive with zeros for gaps", () => {
  const d = fillDays(parseTable(table), "2026-09-30", "2026-10-03");
  assert.deepEqual(d.map((x) => x.day), ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(d[2], { day: "2026-10-02", views: 0, watchMinutes: 0, subsGained: 0, subsLost: 0 });
  assert.equal(d[3].views, 300);
  assert.equal(d[1].subsGained, 2);
});

test("periods end 2 days ago (data lag) with an equal, adjacent previous period", () => {
  const p = periods(7, new Date("2026-10-15T23:30:00Z"));
  assert.deepEqual(p, { start: "2026-10-07", end: "2026-10-13", prevStart: "2026-09-30", prevEnd: "2026-10-06" });
  const y = periods(365, new Date("2026-03-02T00:00:00Z"));
  assert.equal(y.end, "2026-02-28");
  assert.equal(fillDays([], y.start, y.end).length, 365);
  assert.equal(fillDays([], y.prevStart, y.prevEnd).length, 365);
});

test("parseRange and isVideoId validate input", () => {
  assert.equal(parseRange(null), 28);
  assert.equal(parseRange("90"), 90);
  assert.equal(parseRange("30"), null);
  assert.equal(parseRange("7.0"), null);
  assert.ok(isVideoId("dQw4w9WgXcQ"));
  assert.ok(!isVideoId("dQw4w9WgXc"));
  assert.ok(!isVideoId("dQw4w9WgXc&"));
});

test("trafficLabel maps known codes and degrades for unknown ones", () => {
  assert.equal(trafficLabel("YT_SEARCH"), "YouTube search");
  assert.equal(trafficLabel("SHORTS"), "Shorts feed");
  assert.equal(trafficLabel("NO_LINK_OTHER"), "Direct or unknown");
  assert.equal(trafficLabel("SOME_NEW_THING"), "Some new thing");
});

test("totalsFrom sums metrics and weights average view duration by views", () => {
  const t = totalsFrom(parseTable(table));
  assert.equal(t.views, 400);
  assert.equal(t.watchMinutes, 200);
  assert.equal(t.subsGained, 3);
  assert.equal(t.avgViewSec, 53); // (100*30 + 300*60) / 400 = 52.5
  assert.equal(totalsFrom([]).avgViewSec, 0);
});

test("reportUrl targets the v2 API for MINE and encodes filters", () => {
  const u = new URL(reportUrl({ start: "2026-10-01", end: "2026-10-07", metrics: "views", dimensions: "day", filters: "video==abc_DEF-123", sort: "-views", maxResults: 10 }));
  assert.equal(u.origin + u.pathname, "https://youtubeanalytics.googleapis.com/v2/reports");
  assert.equal(u.searchParams.get("ids"), "channel==MINE");
  assert.equal(u.searchParams.get("filters"), "video==abc_DEF-123");
  assert.ok(u.search.includes("filters=video%3D%3Dabc_DEF-123"));
  assert.equal(u.searchParams.get("maxResults"), "10");
  assert.ok(!new URL(reportUrl({ start: "a", end: "b", metrics: "views" })).searchParams.has("filters"));
});

test("PKCE S256 matches the RFC 7636 vector; state helpers", () => {
  // RFC 7636 Appendix B (the verifier is the base64url of its listed octets).
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const s = randomToken();
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(s, randomToken());
  assert.ok(sameSecret(s, s));
  assert.ok(!sameSecret(s, s + "x"));
  assert.ok(!sameSecret("", ""));
});

test("loopbackOrigin allows only ORBIT's own hosts; authUrl asks for offline read-only access", () => {
  assert.equal(loopbackOrigin("localhost:3000"), "http://localhost:3000");
  assert.equal(loopbackOrigin("127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(loopbackOrigin("[::1]:3000"), "http://[::1]:3000");
  for (const h of ["evil.com", "localhost:3001", "localhost", "localhost:3000.evil.com", null]) assert.equal(loopbackOrigin(h), null);
  const u = new URL(authUrl({ clientId: "cid", redirectUri: "http://localhost:3000/api/studio/oauth/callback", state: "st", challenge: "ch" }));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("scope")!.split(" ").every((s) => s.endsWith(".readonly")));
});
