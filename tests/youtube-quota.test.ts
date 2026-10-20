import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import * as pure from "../src/lib/youtube-quota-pure.ts";
import * as viral from "../src/lib/yt-viral-pure.ts";
import * as youtubePure from "../src/lib/youtube-pure.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z"), empty = (): pure.QuotaLedger => ({ v: 1, days: [] });
const compile = (name: string) => ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const quotaCode = compile("youtube-quota"), youtubeCode = compile("youtube");
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test("quota accounts weighted units and actual attempts separately for each caller", () => {
  let l = empty();
  for (const endpoint of ["search", "videos", "channels", "analytics"]) l = pure.account(l, "herald", "herald", endpoint, NOW);
  l = pure.account(l, "studio", "manual", "playlistItems", NOW);
  const d = pure.today(l, NOW);
  assert.deepEqual(d.callers.herald, { group: "herald", units: 102, calls: 4, searches: 1, dataUnits: 2, analytics: 1 });
  assert.equal(d.callers.studio.units, 1);
  assert.equal(pure.totalUnits(d), 103);
  assert.match(pure.quotaSummary(d), /herald: 102/);
  assert.equal(pure.today(l, NOW + 86_400_000).callers.herald, undefined);
});

test("fixed shares leave twenty percent exclusively for manual actions", () => {
  const d = pure.today(empty(), NOW);
  assert.deepEqual(Object.keys(pure.SHARES).map((g) => pure.quotaLeft(d, g as pure.QuotaGroup, 4000)), [1600, 1000, 600, 800]);
  let l = empty();
  for (const [group, n] of [["herald", 16], ["scout", 10], ["niche", 6]] as const)
    for (let i = 0; i < n; i++) l = pure.account(l, group, group, "search", NOW);
  assert.equal(pure.totalUnits(pure.today(l, NOW)), 3200);
  for (const g of ["herald", "scout", "niche"] as const) assert.equal(pure.quotaLeft(pure.today(l, NOW), g, 4000), 0);
  assert.equal(pure.quotaLeft(pure.today(l, NOW), "manual", 4000), 800);
});

test("midnight Pacific resets in summer, winter, and across DST changes", () => {
  for (const midnight of ["2026-07-02T07:00:00Z", "2026-12-02T08:00:00Z", "2026-03-09T07:00:00Z", "2026-11-02T08:00:00Z"]) {
    const t = Date.parse(midnight), l = pure.account(empty(), "scout", "scout", "search", t - 1);
    assert.notEqual(pure.pacificDay(t - 1), pure.pacificDay(t));
    assert.equal(pure.totalUnits(pure.today(l, t)), 0);
    assert.equal(pure.totalUnits(pure.today(l, t - 1)), 100);
  }
  assert.equal(pure.pacificDay(Date.parse("2026-10-21T02:00:00Z")), "2026-10-20");
});

test("ledger retains seven days and rejects damaged counters", () => {
  let l = empty();
  for (let i = 0; i < 10; i++) l = pure.account(l, "scout", "scout", "videos", NOW + i * 86_400_000);
  assert.equal(l.days.length, 7);
  assert.deepEqual(pure.parseQuota(JSON.stringify(l)), l);
  assert.equal(pure.parseQuota("broken"), null);
  l.days[0].callers.scout.units = -1;
  assert.equal(pure.parseQuota(JSON.stringify(l)), null);
});

test("discovery window stays stable between refreshes and video ids are deduplicated", () => {
  const t = Date.parse("2026-10-20T12:01:00Z");
  assert.equal(pure.discoveryAfter(t, 86_400_000), pure.discoveryAfter(t + 3_600_000, 86_400_000));
  assert.notEqual(pure.discoveryAfter(t, 86_400_000), pure.discoveryAfter(t + 3 * 3_600_000, 86_400_000));
  assert.deepEqual(pure.uniqueVideoIds(["abcdefghijk", "abcdefghijk", "bad", "01234567890"]), ["abcdefghijk", "01234567890"]);
});

function quotaHarness(legacy?: number, corrupt = false) {
  let now = NOW, scheduled: (() => void) | undefined;
  const files = new Map<string, string>(), notices: unknown[] = [];
  const m = { exports: {} as any };
  runInNewContext(quotaCode, { module: m, exports: m.exports, process: { env: {}, cwd: () => "/orbit" },
    Date: class extends Date { static now() { return now; } }, console: { info() {}, error() {} },
    setTimeout: (fn: () => void) => { scheduled = fn; return { unref() {} }; },
    require: (name: string) => {
      if (name === "node:async_hooks") return { AsyncLocalStorage };
      if (name === "node:path") return path;
      if (name === "./data-dir") return { orbitDataDir: () => "/data" };
      if (name === "./activity") return { logActivity: (v: unknown) => notices.push(v) };
      if (name === "./youtube-quota-pure") return pure;
      if (name === "node:fs") return { readFileSync: (p: string) => {
        if (p.endsWith("youtube-quota.json") && corrupt) return "broken";
        if (p.endsWith("scout.json") && legacy !== undefined) return JSON.stringify({ quota: { day: pure.pacificDay(now), used: legacy } });
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      } };
      if (name === "node:fs/promises") return { mkdir: async () => {}, writeFile: async (p: string, text: string) => files.set(p, text), rename: async (a: string, b: string) => files.set(b, files.get(a)!) };
      throw new Error(name);
    },
  });
  return { q: m.exports, notices, files, advance: (ms: number) => { now += ms; }, flush: async () => { scheduled?.(); await new Promise((r) => setImmediate(r)); } };
}

test("upgrade preserves the old total without guessing which caller spent it", () => {
  const { q } = quotaHarness(3934);
  assert.equal(q.youtubeQuotaView().used, 3934);
  assert.equal(q.youtubeRemaining("manual"), 66);
  assert.equal(q.youtubeRemaining("herald"), 0);
  assert.equal(q.youtubeQuotaView().callers["legacy-unattributed"].units, 3934);
});

test("damaged persisted ledger fails closed until the next Pacific day", () => {
  const h = quotaHarness(undefined, true);
  assert.equal(h.q.youtubeRemaining("manual"), 0);
  h.advance(86_400_000);
  assert.equal(h.q.youtubeRemaining("manual"), 800);
});

test("concurrent scopes cannot overshoot a share and a wait is announced only once per day", async () => {
  const h = quotaHarness(), q = h.q;
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => q.withYoutubeBudget(`worker-${i}`, "herald", async () => {
    await Promise.resolve(); q.meterYoutube("search");
  })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 16);
  assert.equal(q.youtubeQuotaView().used, 1600);
  assert.equal(h.notices.length, 1);
  assert.equal(q.youtubeRemaining("manual"), 800);
  await q.withYoutubeBudget("owner", "manual", async () => q.meterYoutube("videos"));
  assert.equal(q.youtubeQuotaView().callers.owner.group, "manual");
  assert.equal(q.youtubeQuotaView().callers["worker-0"].group, "herald");
  await h.flush();
  const saved = [...h.files.values()].at(-1)!;
  assert.equal(pure.totalUnits(pure.today(pure.parseQuota(saved)!, NOW)), 1601);
  h.advance(86_400_000);
  assert.throws(() => q.requireYoutubeUnits("herald", 1601), /midnight Pacific/);
  assert.equal(h.notices.length, 2);
});

function youtubeHarness() {
  let now = NOW, charged = 0, fail = false;
  const requests: URL[] = [], m = { exports: {} as any };
  runInNewContext(youtubeCode, { module: m, exports: m.exports, Date: class extends Date { static now() { return now; } },
    URLSearchParams, AbortSignal, process: { env: {} },
    fetch: async (url: string) => { requests.push(new URL(url)); return { ok: !fail, status: 503, json: async () => fail ? { error: { message: "unavailable" } } : { items: [] } }; },
    require: (name: string) => name === "node:crypto" ? { createHash } : name === "./youtube-quota-pure" ? pure : name === "./youtube-quota" ? { meterYoutube: () => { charged++; }, withYoutubeBudget: (_c: string, _g: string, fn: () => unknown) => fn() } : {},
  });
  return { yt: m.exports, requests, charges: () => charged, advance: (ms: number) => { now += ms; }, fail: (v: boolean) => { fail = v; } };
}

test("cache hits and concurrent identical calls cost no additional units", async () => {
  const h = youtubeHarness();
  await Promise.all(Array.from({ length: 5 }, () => h.yt.api("search", { q: "clips" }, "key")));
  assert.equal(h.charges(), 1);
  await h.yt.api("search", { q: "clips" }, "key");
  assert.equal(h.charges(), 1);
  h.advance(3 * 3_600_000);
  await h.yt.api("search", { q: "clips" }, "key");
  assert.equal(h.charges(), 2);
});

test("failed outbound attempts are charged and never cached", async () => {
  const h = youtubeHarness(); h.fail(true);
  for (let i = 0; i < 2; i++) await assert.rejects(h.yt.api("videos", { id: "abcdefghijk" }, "key"), /503/);
  assert.equal(h.charges(), 2);
  h.fail(false); await h.yt.api("videos", { id: "abcdefghijk" }, "key");
  assert.equal(h.charges(), 3);
});

test("cache identities isolate credentials, filters, and pages; parameter order is irrelevant", () => {
  const { yt } = youtubeHarness(), id = yt.requestIdentity("search", { q: "a", pageToken: "1" }, "secret");
  assert.equal(id, yt.requestIdentity("search", { pageToken: "1", q: "a" }, "secret"));
  assert.notEqual(id, yt.requestIdentity("search", { q: "a", pageToken: "2" }, "secret"));
  assert.notEqual(id, yt.requestIdentity("search", { q: "a", pageToken: "1" }, "other"));
  assert.ok(!id.includes("secret"));
});

test("six-hour channel caching and explicit owner freshness override", async () => {
  const h = youtubeHarness();
  await h.yt.api("channels", { id: "UCowner" }, "key");
  h.advance(2 * 3_600_000);
  await h.yt.api("channels", { id: "UCowner" }, "key");
  assert.equal(h.charges(), 1);
  await h.yt.api("channels", { id: "UCowner" }, "key", 60_000);
  assert.equal(h.charges(), 2);
  h.advance(6 * 3_600_000);
  await h.yt.api("channels", { id: "UCowner" }, "key");
  assert.equal(h.charges(), 3);
});

test("video reader batches fifty and never fetches duplicate or missing ids twice per run", async () => {
  const { yt } = youtubeHarness(), batches: string[][] = [];
  const ids = Array.from({ length: 65 }, (_, i) => String(i).padStart(11, "0"));
  const read = yt.videoReader(async (p: Record<string, string>) => {
    const batch = p.id.split(","); batches.push(batch);
    return { items: batch.filter((id) => id !== ids[0]).map((id) => ({ id })) };
  }, "statistics");
  assert.equal((await read([...ids, ids[1]])).length, 64);
  assert.deepEqual(batches.map((b) => b.length), [50, 15]);
  assert.deepEqual(plain(await read([ids[0], ids[1]])), [{ id: ids[1] }]);
  assert.equal(batches.length, 2);
});

test("eight Herald scans retain broad discovery with twelve searches plus cheap watched uploads", async () => {
  const h = youtubeHarness(), m = { exports: {} as any }, calls: URL[] = [];
  let now = NOW, meter = { units: 0 }, revoked = false;
  class OAuthError extends Error {}
  runInNewContext(compile("devtools"), { module: m, exports: m.exports, URLSearchParams, AbortSignal, Error,
    Date: class extends Date { static now() { return now; } },
    fetch: async (raw: string) => {
      const url = new URL(raw); calls.push(url);
      const endpoint = url.pathname.split("/").at(-1);
      const items = endpoint === "search" ? [{ id: { videoId: "broad000001" } }]
        : endpoint === "playlistItems" ? [{ contentDetails: { videoId: "watched0001" } }]
        : url.searchParams.get("id")!.split(",").map((id) => ({ id, snippet: { title: id, channelTitle: "Creator", publishedAt: new Date(NOW - 3_600_000).toISOString() }, statistics: { viewCount: "10000" }, contentDetails: { duration: "PT45S" } }));
      return { ok: true, status: 200, json: async () => ({ items }) };
    },
    require: (name: string) => {
      if (name === "./youtube") return h.yt;
      if (name === "./youtube-quota-pure") return pure;
      if (name === "./youtube-pure") return youtubePure;
      if (name === "./yt-viral-pure") return viral;
      if (name === "./youtube-quota") return { meterYoutube: (endpoint: string) => { meter.units += pure.weightedCost(endpoint); },
        withYoutubeBudget: (_c: string, _g: string, fn: (s: { units: number }) => unknown) => { meter = { units: 0 }; return fn(meter); } };
      if (name === "./yt-oauth") return { OAuthError, oauthEnv: () => true, readStored: async () => ({ channelId: "owner", connectedAt: "today" }),
        getAccessToken: async () => { if (revoked) throw new OAuthError("invalid_grant"); return "token"; }, invalidateAccess() {} };
      if (name === "./clips/scout") return { scoutView: async () => ({ scout: { watchlist: Array.from({ length: 5 }, (_, i) => ({ title: `Creator ${i}`, channelId: `UC${String(i).repeat(22)}` })) } }) };
      if (name === "./clips/factory") return { studioRoot: () => "/studio", readState: async () => ({ clips: {} }) };
      if (name === "./clips/learn-pure") return { judgeShorts: () => [], learnProblem: () => null };
      if (name === "./clips/scout-pure") return { allKeywords: () => [] };
      return {};
    },
  });
  for (let i = 0; i < 8; i++) {
    const r = await m.exports.nicheViral(now, "herald");
    assert.equal(r.videos.length, 2, r.error);
    now += 3 * 3_600_000; h.advance(3 * 3_600_000);
  }
  const count = (endpoint: string) => calls.filter((u) => u.pathname.endsWith(`/${endpoint}`)).length;
  assert.equal(count("search"), 12, "same broad queries retained, refreshed six-hourly instead of three-hourly");
  assert.equal(count("playlistItems"), 40, "five watched channels refreshed eight times");
  assert.equal(count("videos"), 8);
  for (const u of calls.filter((u) => u.pathname.endsWith("/videos"))) assert.equal(u.searchParams.get("id")!.split(",").length, 2);
  const before = calls.length;
  revoked = true;
  const cached = await m.exports.nicheViral(now, "manual");
  assert.equal(cached.videos.length, 2, "last good results survive an expired login");
  assert.equal(calls.length, before, "an OAuth failure is not counted as a Data API attempt");
});

test("usage endpoint exposes caller accounting only after authentication", async () => {
  const code = ts.transpileModule(readFileSync(new URL("../src/app/api/usage-meter/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let allowed = false, reads = 0;
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response,
    require: (name: string) => name.endsWith("supabase/server") ? { requireUser: async () => allowed ? {} : { res: new Response("Unauthorized", { status: 401 }) } }
      : name.endsWith("youtube-quota") ? { youtubeQuotaView: () => { reads++; return { used: 301, callers: { herald: { units: 301 } } }; } }
      : { usageView: () => ({ ok: true }) },
  });
  assert.equal((await m.exports.GET()).status, 401);
  assert.equal(reads, 0);
  allowed = true;
  const body = await (await m.exports.GET()).json();
  assert.equal(body.youtube.callers.herald.units, 301);
});
