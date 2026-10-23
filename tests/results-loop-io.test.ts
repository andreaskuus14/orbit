import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pure from "../src/lib/clips/learn-pure.ts";

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const learnCode = compile("lib/clips/learn.ts");
function collector(options: { stopped?: boolean; analyticsFail?: boolean; dataFail?: boolean; future?: boolean } = {}) {
  const now = Date.now(), pub = new Date(now + (options.future ? 24 : -48) * 3_600_000).toISOString();
  const record = { videoId: "abcdefghijk", jobId: "j", clipId: "c", title: "My Short", hook: "The hook", reason: "", layout: "fit", captions: "none", durationSec: 20,
    sourceChannel: "owner", kind: "other", publishedAt: pub, snaps: {} };
  let saved = { ...pure.emptyLearn(), checkedAt: new Date(now - 7 * 3_600_000).toISOString(), clips: { abcdefghijk: record } } as pure.LearnState;
  const calls: any[] = [], writes: any[] = [], timers: any[] = [];
  const m = { exports: {} as any };
  runInNewContext(learnCode, { module: m, exports: m.exports, process: { env: { YOUTUBE_API_KEY: "test-only" } }, console,
    setInterval: (fn: any, ms: number) => { timers.push({ fn, ms }); return { unref() {} }; }, clearInterval() {},
    require: (name: string) => {
      if (name === "node:path") return require(name);
      if (name === "node:fs/promises") return { access: async () => { throw new Error("no file"); } };
      if (name.endsWith("/learn-pure")) return pure;
      if (name.endsWith("/flop-retry")) return { retryFlops: async () => {}, reconcileReplacements: async () => {} };
      if (name.endsWith("/stop-all")) return { stopAllOn: () => !!options.stopped };
      if (name.endsWith("/factory")) return { readState: async () => saved, listJobs: async () => [], studioRoot: () => "/test-studio", saveState: async (...args: any[]) => {
        writes.push(structuredClone(args)); saved = structuredClone(args[2]);
      } };
      if (name.endsWith("/youtube")) return { api: async (resource: string, params: object) => { calls.push({ resource, params });
        if (options.dataFail) throw new Error("quota unavailable");
        return { items: [{ id: record.videoId, snippet: { publishedAt: pub }, statistics: { viewCount: "432", likeCount: "12", commentCount: "2" } }] };
      } };
      if (name.endsWith("/yt-analytics")) return { getAnalyticsReport: async (_s: any, q: any) => { calls.push(q);
        if (options.analyticsFail) throw new Error("Analytics delayed");
        return [{ video: record.videoId, averageViewPercentage: 87.5, averageViewDuration: 17.5, subscribersGained: 1 }];
      } };
      if (name.endsWith("/yt-analytics-pure")) return { YT_SCOPES: ["analytics.readonly"], hasScopes: () => true };
      if (name.endsWith("/yt-oauth")) return { readStored: async () => ({ scope: "analytics.readonly" }) };
      if (name.endsWith("/claude")) return { askClaude: () => { throw new Error("Stats must not call AI"); } };
      if (name.endsWith("/usage-meter") || name.endsWith("/titles") || name.endsWith("/devlog") || name.endsWith("/autopilot-pure")) return {};
      throw new Error(name);
    },
  });
  return { api: m.exports, calls, writes, timers, state: () => saved };
}

test("results collector uses read-only existing APIs, persists 48h stats once and shares the collection lock", async () => {
  const a = collector();
  await Promise.all([a.api.learnView(), a.api.learnView()]);
  assert.equal(a.writes.length, 1);
  const s = a.state().clips.abcdefghijk.snaps["48h"]!;
  assert.equal(s.views, 432); assert.equal(s.avgViewPct, 87.5);
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[0].resource, "videos");
  assert.equal(a.calls[1].filters, "video==abcdefghijk");
  assert.match(a.calls[1].metrics, /averageViewPercentage/);
  await a.api.learnView();
  assert.equal(a.writes.length, 1);
});

test("results collector tolerates Analytics lag without fake retention; failed views do not create a snapshot", async () => {
  const lag = collector({ analyticsFail: true });
  const view = await lag.api.learnView();
  assert.equal(lag.state().clips.abcdefghijk.snaps["48h"]!.avgViewPct, undefined);
  assert.match(view.warnings.join(" "), /Analytics delayed/);
  const fail = collector({ dataFail: true });
  await fail.api.learnView();
  assert.equal(fail.state().clips.abcdefghijk.snaps["48h"], undefined);
  const future = collector({ future: true });
  await future.api.learnView();
  assert.equal(future.state().clips.abcdefghijk.snaps["48h"], undefined);
});

test("results timer starts once, runs without a UI, and respects Stop-all", async () => {
  const a = collector();
  a.api.startResultsLoop(); a.api.startResultsLoop();
  await a.api.learnView();
  assert.equal(a.timers.length, 1);
  assert.equal(a.timers[0].ms, pure.RESULTS_POLL_MS);
  assert.equal(a.writes.length, 1);
  const stopped = collector({ stopped: true });
  stopped.api.startResultsLoop();
  await stopped.api.learnView();
  assert.equal(stopped.calls.length, 0); assert.equal(stopped.writes.length, 0);
});

test("Last Shorts renders escaped titles, 48h views, both directions, baseline waiting and optional retention", () => {
  const m = { exports: {} as any };
  runInNewContext(compile("components/LastShorts.tsx"), { module: m, exports: m.exports, require: (n: string) => (n === "./world-paused" ? { useWorldPaused: () => false } : require(n)) });
  const rows: pure.ShortResult[] = [
    { videoId: "abcdefghijk", title: "<script>My title</script>", hook: "", capturedAt: "", views48: 400, medianViews: 200, changePct: 100, verdict: "worked", avgViewPct: 0 },
    { videoId: "lmnopqrstuv", title: "Slow start", hook: "", capturedAt: "", views48: 100, medianViews: 200, changePct: -50, verdict: "flopped" },
    { videoId: "12345678901", title: "New channel", hook: "", capturedAt: "", views48: 200, medianViews: null, changePct: null, verdict: null },
  ];
  const html = renderToStaticMarkup(createElement(m.exports.ShortsStrip, { shorts: rows }));
  assert.match(html, /Last Shorts/); assert.match(html, /400 views at 48h/);
  assert.match(html, /↑ 100% vs median · worked/); assert.match(html, /↓ 50% vs median · flopped/);
  assert.match(html, /Waiting for a channel baseline/); assert.match(html, /0% average viewed/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  assert.match(renderToStaticMarkup(createElement(m.exports.ShortsStrip, { shorts: [] })), /Results appear after/);
});


test("results endpoint remains authenticated and leaves the regular Analytics path intact", async () => {
  const code = compile("app/api/studio/analytics/route.ts");
  let authorized = false, resultCalls = 0, analyticsCalls = 0;
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, URL, require: (name: string) => {
    if (name.endsWith("supabase/server")) return { requireUser: async () => authorized ? {} : { res: new Response("Unauthorized", { status: 401 }) } };
    if (name.endsWith("clips/learn")) return { learnView: async () => { resultCalls++; return { lastShorts: [], checkedAt: "now", warnings: [] }; } };
    if (name.endsWith("yt-analytics")) return { getAnalytics: async () => { analyticsCalls++; return { connected: false, reason: "not_connected" }; } };
    if (name.endsWith("yt-analytics-pure")) return { parseRange: () => 28, isVideoId: () => true };
    throw new Error(name);
  } });
  const results = () => m.exports.GET(new Request("http://localhost/api/studio/analytics?results=1"));
  assert.equal((await results()).status, 401); assert.equal(resultCalls, 0);
  authorized = true;
  assert.deepEqual(await (await results()).json(), { shorts: [], checkedAt: "now", warnings: [] });
  assert.equal(resultCalls, 1); assert.equal(analyticsCalls, 0);
  assert.equal((await m.exports.GET(new Request("http://localhost/api/studio/analytics?range=28"))).status, 200);
  assert.equal(analyticsCalls, 1);
});
