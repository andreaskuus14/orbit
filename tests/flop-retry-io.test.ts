import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as learn from "../src/lib/clips/learn-pure.ts";
import * as policy from "../src/lib/clips/flop-retry-pure.ts";
import * as clipPure from "../src/lib/clips/pure.ts";
import * as approvalPure from "../src/lib/approval-pure.ts";
import * as analytics from "../src/lib/yt-analytics-pure.ts";
import { crossSiteBlocked } from "../src/lib/csrf.ts";
import type { Clip, ClipJob } from "../src/lib/clips/types.ts";

const require = createRequire(import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const oldClip = (): Clip => ({ id: "clip-1", title: "Old Short", hook: "Old hook", start: 0, end: 20, reason: "", score: 0.5, status: "approved", video: "clips/original.mp4", publish: { status: "done", videoId: "abcdefghijk", title: "Old Short", privacy: "public", at: "" } });
const makeJob = (clips: Clip[]): ClipJob => ({ id: "abcdef-123456", source: "source.mp4", status: "done", createdAt: "", updatedAt: "", step: "", warnings: [], progress: 1, options: { count: 1, maxSec: 30, captions: true }, clips });
const analysis = { v: 1 as const, duration: 200, words: [{ text: "new scene", start: 90, end: 95 }], spans: [], rms: [], cands: [], moments: [], hasAudio: true };

function factory() {
  const m = { exports: {} as any }, writes: any[] = [];
  runInNewContext(compile("lib/clips/factory.ts"), { module: m, exports: m.exports, process: { env: {}, cwd: () => "/test", pid: 1 }, console, AbortController,
    __orbitClips: { write: Promise.resolve(), deleted: new Set(), verChain: new Promise(() => {}) }, // keep the renderer queued; it must not run in this test
    require: (n: string) => {
      if (n === "node:fs/promises") return { mkdir: async () => {}, open: async () => ({ writeFile: async (s: string) => writes.push(JSON.parse(s)), sync: async () => {}, close: async () => {} }), rename: async () => {}, rm: async () => {} };
      if (n.startsWith("node:")) return require(n);
      if (n === "./pure") return clipPure;
      if (n === "./format") return { rootClipId: (s: string) => s.replace(/-v\d+$/, "") };
      if (n === "./flop-retry-pure") return policy;
      if (n === "../approval-pure") return approvalPure;
      if (n === "../asr-pool") return { asrWorkers: () => 1 };
      return {};
    },
  });
  return { api: m.exports, writes };
}

test("actual startVersion atomically links a review-only retry and preserves lineage on manually made versions", async () => {
  const f = factory(), old = oldClip(), j = makeJob([old]); old.flopRetry = { at: "claimed" };
  const child = await f.api.startVersion(j, old, { edit: {}, dStart: 0, dEnd: 0, suggest: true }, analysis, { span: { start: 90, end: 110 }, of: { clipId: old.id, videoId: "abcdefghijk", title: old.title } });
  assert.equal(child.status, "rendering"); assert.equal(child.start, 90); assert.equal(child.publish, undefined);
  assert.equal(f.writes[0].clips[0].flopRetry.clipId, child.id);
  assert.equal(f.writes[0].clips[1].retryOf.videoId, "abcdefghijk");
  const manual = await f.api.startVersion(j, child, { edit: {}, dStart: 0, dEnd: 0, suggest: false }, analysis);
  assert.equal(manual.retryOf.clipId, old.id); assert.equal(manual.retryApproved, undefined);
});

test("actual approval saves exact replacement consent, rejects programmatic approval, and invalidates edits", async () => {
  const f = factory(), c = oldClip(); c.publish = undefined; c.status = "ready"; c.retryOf = { clipId: "clip-2", videoId: "lmnopqrstuv", title: "Prior" };
  const j = makeJob([c]);
  await assert.rejects(f.api.updateClip(j, c, { status: "approved" }), /review queue/);
  assert.equal(c.status, "ready");
  await f.api.updateClip(j, c, { status: "approved" }, true);
  assert.ok(policy.retryConsent(c));
  await f.api.updateClip(j, c, { title: "Edited after approval" });
  assert.equal(c.status, "ready"); assert.equal(c.retryApproved, undefined);
  await assert.rejects(f.api.startPublish(j, c, "/fake", {}), /exact retry/);
});

function retrySystem(options: { startFail?: boolean; privacyFail?: boolean; publicRetry?: boolean } = {}) {
  let j = makeJob([oldClip()]), state = structuredClone(j), chain: Promise<any> = Promise.resolve();
  const starts: any[] = [], writes: any[] = [], privacy: any[] = [];
  const m = { exports: {} as any };
  runInNewContext(compile("lib/clips/flop-retry.ts"), { module: m, exports: m.exports, console, require: (n: string) => {
    if (n === "node:path") return require(n);
    if (n === "node:fs/promises") return { stat: async () => ({ isFile: () => true }) };
    if (n.endsWith("/stop-all")) return { stopAllOn: () => false };
    if (n.endsWith("/usage-meter")) return { usageHold: () => null };
    if (n.endsWith("/learn-pure")) return learn;
    if (n.endsWith("/flop-retry-pure")) return policy;
    if (n.endsWith("/pure")) return clipPure;
    if (n.endsWith("/youtube-privacy")) return { changeRetryPrivacy: async (...args: any[]) => { privacy.push(args); if (options.privacyFail) throw Error("network outcome unknown"); return args[1] === "public" || !!options.publicRetry; } };
    if (n.endsWith("/factory")) return { getJob: async () => j, listJobs: async () => [j], inboxDir: () => "/test", loadAnalysis: async () => analysis, isJobBusy: () => false,
      withJobLock: (fn: any) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; },
      saveJob: async (job: any) => { state = structuredClone(job); writes.push(state); },
      startVersion: async (job: ClipJob, old: Clip, req: any, a: any, info: any) => {
        assert.ok(state.clips[0].flopRetry, "claim must already be saved before any render can start"); starts.push({ req, info });
        if (options.startFail) throw Error("render could not start");
        const c = { ...old, id: "clip-1-v2", title: "New Short", status: "ready" as const, retryOf: info.of, flopRetry: undefined, publish: undefined };
        job.clips.push(c); old.flopRetry!.clipId = c.id; state = structuredClone(job); return c;
      } };
    throw Error(n);
  } });
  const rec = (id: string, views: number, i: number): learn.LearnRec => ({ videoId: id, clipId: `clip-${i}`, jobId: j.id, title: "", hook: "", reason: "", sourceChannel: "", layout: "fit", captions: "none", kind: "other", durationSec: 20, publishedAt: "2026-10-20T00:00:00Z", snaps: { "24h": { at: "2026-10-21T00:00:00Z", views, likes: 0, comments: 0 } } });
  const recs = [rec("abcdefghijk", 1, 1), rec("lmnopqrstuv", 100, 2), rec("12345678901", 100, 3)];
  const stats = { ...learn.emptyLearn(), clips: Object.fromEntries(recs.map((r) => [r.videoId, r])) };
  return { api: m.exports, stats, starts, writes, privacy, job: () => j, restart: () => { j = structuredClone(state); } };
}

test("concurrent ticks and restarts spend one retry only, even after an uncertain start failure", async () => {
  for (const startFail of [false, true]) {
    const a = retrySystem({ startFail });
    await Promise.all([a.api.retryFlops(a.stats), a.api.retryFlops(a.stats)]);
    a.restart(); await a.api.retryFlops(a.stats);
    assert.equal(a.starts.length, 1); assert.equal(a.starts[0].req.suggest, true); assert.equal(a.privacy.length, 0);
  }
});

test("no privacy before consent/publication; replacement is reversible and restore disables future hiding", async () => {
  const a = retrySystem({ publicRetry: true }); await a.api.retryFlops(a.stats);
  const retry = a.job().clips[1];
  await a.api.reconcileReplacements(); assert.equal(a.privacy.length, 0);
  retry.status = "approved"; retry.retryApproved = { at: "owner click", fingerprint: policy.retryFingerprint(retry) };
  await a.api.reconcileReplacements(); assert.equal(a.privacy.length, 0);
  retry.publish = { status: "scheduled", at: "", videoId: "lmnopqrstuv", title: retry.title };
  await a.api.reconcileReplacements();
  assert.deepEqual(Array.from(a.privacy[0]), ["abcdefghijk", "private", "lmnopqrstuv"]);
  assert.ok(a.job().clips[0].notes!.some((n) => n.includes("Restore")));
  assert.equal(a.job().clips[0].publish!.privacy, "private");
  await a.api.restoreOriginal(a.job().id, "clip-1", "abcdefghijk");
  assert.equal(a.job().clips[0].publish!.privacy, "public");
  await a.api.reconcileReplacements(); assert.equal(a.privacy.length, 2);
  await assert.rejects(a.api.restoreOriginal(a.job().id, "clip-1", "12345678901"), /reload/);
});

test("uncertain privacy failures keep a durable recovery marker and leave the original's known privacy unchanged", async () => {
  const a = retrySystem({ privacyFail: true }); await a.api.retryFlops(a.stats);
  const retry = a.job().clips[1]; retry.status = "approved";
  retry.retryApproved = { at: "click", fingerprint: policy.retryFingerprint(retry) };
  retry.publish = { status: "done", at: "", videoId: "lmnopqrstuv", title: retry.title };
  await a.api.reconcileReplacements();
  assert.equal(a.job().clips[0].flopRetry!.privacyPending, true);
  assert.match(a.job().clips[0].flopRetry!.error!, /unknown/);
  assert.equal(a.job().clips[0].publish!.privacy, "public");
});

function privacyApi(options: { granted?: boolean; replacementPrivacy?: string; processing?: string; wrongChannel?: boolean; putFail?: boolean } = {}) {
  const calls: any[] = [], charged: string[] = [], m = { exports: {} as any };
  runInNewContext(compile("lib/youtube-privacy.ts"), { module: m, exports: m.exports, AbortSignal,
    fetch: async (url: string, init: any) => {
      calls.push({ url, ...init });
      if (init.method === "PUT") return options.putFail ? new Response("bad", { status: 503 }) : Response.json({ id: "abcdefghijk", status: { privacyStatus: JSON.parse(init.body).status.privacyStatus } });
      return Response.json({ items: [{ id: "abcdefghijk", snippet: { channelId: options.wrongChannel ? "other" : "mine" }, status: { privacyStatus: "public", uploadStatus: "processed", license: "creativeCommon", embeddable: false, publicStatsViewable: false, selfDeclaredMadeForKids: false } },
        { id: "lmnopqrstuv", snippet: { channelId: "mine" }, status: { privacyStatus: options.replacementPrivacy ?? "public", uploadStatus: options.processing ?? "processed" } }] });
    }, require: (n: string) => {
      if (n.endsWith("yt-oauth")) return { readStored: async () => ({ scope: options.granted === false ? analytics.YT_UPLOAD_SCOPE : analytics.YT_MANAGE_SCOPE, channelId: "mine" }), getAccessToken: async () => "not-a-real-token", invalidateAccess() {} };
      if (n.endsWith("yt-analytics-pure")) return analytics;
      if (n.endsWith("flop-retry-pure")) return policy;
      if (n.endsWith("youtube-quota")) return { withYoutubeBudget: (_a: any, _b: any, fn: any) => fn(), meterYoutube: (s: string) => charged.push(s) };
      if (n.endsWith("stop-all")) return { stopAllOn: () => false };
      throw Error(n);
    },
  });
  return { api: m.exports, calls, charged };
}

test("real privacy adapter never writes for missing permission, another channel, scheduled/private or processing retries", async () => {
  const denied = privacyApi({ granted: false });
  await assert.rejects(denied.api.changeRetryPrivacy("abcdefghijk", "private", "lmnopqrstuv"), /Reconnect/); assert.equal(denied.calls.length, 0);
  for (const opts of [{ replacementPrivacy: "private" }, { replacementPrivacy: "unlisted" }, { processing: "uploaded" }]) {
    const a = privacyApi(opts); assert.equal(await a.api.changeRetryPrivacy("abcdefghijk", "private", "lmnopqrstuv"), false);
    assert.equal(a.calls.length, 1); assert.ok(a.calls.every((c) => c.method !== "PUT"));
  }
  const wrong = privacyApi({ wrongChannel: true });
  await assert.rejects(wrong.api.changeRetryPrivacy("abcdefghijk", "private", "lmnopqrstuv"), /another channel/);
  assert.equal(wrong.calls.length, 1);
});

test("real privacy PUT preserves original status properties and uses only the specific original video id", async () => {
  const a = privacyApi();
  assert.equal(await a.api.changeRetryPrivacy("abcdefghijk", "private", "lmnopqrstuv"), true);
  const write = a.calls[1]; assert.equal(write.method, "PUT"); assert.match(write.url, /part=status$/);
  assert.deepEqual(JSON.parse(write.body), { id: "abcdefghijk", status: { license: "creativeCommon", embeddable: false, publicStatsViewable: false, selfDeclaredMadeForKids: false, privacyStatus: "private" } });
  assert.deepEqual(a.charged, ["videos", "videos.update"]);
  assert.ok(a.calls.every((c) => c.method !== "DELETE"));
  await assert.rejects(privacyApi({ putFail: true }).api.changeRetryPrivacy("abcdefghijk", "private", "lmnopqrstuv"), /503/);
});

function routes(options: { authenticated?: boolean } = {}) {
  const c = oldClip(); c.status = "ready"; c.retryOf = { clipId: "clip-2", videoId: "lmnopqrstuv", title: "Previous Short" };
  const j = makeJob([c]), updates: any[] = [], restores: any[] = [];
  const load = (path: string) => {
    const m = { exports: {} as any };
    runInNewContext(compile(path), { module: m, exports: m.exports, Response, require: (n: string) => {
      if (n.endsWith("supabase/server")) return { requireUser: async () => options.authenticated === false ? { res: new Response("Unauthorized", { status: 401 }) } : {} };
      if (n.endsWith("/csrf")) return { crossSiteBlocked };
      if (n.endsWith("clips/pure")) return clipPure;
      if (n.endsWith("clips/factory")) return { startClipQueue() {}, withJobLock: (fn: any) => fn(), getJob: async () => j, updateClip: async (...args: any[]) => updates.push(args) };
      if (n.endsWith("clips/flop-retry")) return { restoreOriginal: async (...args: any[]) => { restores.push(args); return c; } };
      throw Error(n);
    } }); return m.exports;
  };
  return { approval: load("app/api/studio/clips/[job]/[clip]/route.ts"), restore: load("app/api/studio/clips/[job]/[clip]/restore/route.ts"), updates, restores };
}
const params = { params: Promise.resolve({ job: "abcdef-123456", clip: "clip-1" }) };
const request = (method: string, body: any, cross = false) => new Request("http://localhost/api/studio/clips/abcdef-123456/clip-1", { method, headers: { "Content-Type": "application/json", ...(cross ? { "sec-fetch-site": "cross-site" } : {}) }, body: JSON.stringify(body) });

test("approval and restore handlers require authentication and same-origin writes; approval must name the reviewed original", async () => {
  const a = routes();
  assert.equal((await a.approval.PATCH(request("PATCH", { status: "approved" }), params)).status, 409);
  assert.equal((await a.approval.PATCH(request("PATCH", { status: "approved", replaceOriginal: "abcdefghijk" }), params)).status, 409);
  assert.equal(a.updates.length, 0);
  assert.equal((await a.approval.PATCH(request("PATCH", { status: "approved", replaceOriginal: "lmnopqrstuv" }), params)).status, 200);
  assert.equal(a.updates[0][3], true);
  assert.equal((await a.restore.POST(request("POST", { videoId: "lmnopqrstuv" }, true), params)).status, 403); assert.equal(a.restores.length, 0);
  const denied = routes({ authenticated: false });
  assert.equal((await denied.restore.POST(request("POST", { videoId: "lmnopqrstuv" }), params)).status, 401);
  assert.equal((await denied.approval.PATCH(request("PATCH", { status: "approved", replaceOriginal: "lmnopqrstuv" }), params)).status, 401);
  assert.equal((await a.restore.POST(request("POST", { videoId: "lmnopqrstuv" }), params)).status, 200); assert.equal(a.restores.length, 1);
});

test("Last Shorts shows 24h flop/retry/restore controls without inventing 48h views", async () => {
  const { createElement } = await import("react"); const { renderToStaticMarkup } = await import("react-dom/server");
  const m = { exports: {} as any };
  runInNewContext(compile("components/LastShorts.tsx"), { module: m, exports: m.exports, require: (n: string) => (n === "./world-paused" ? { useWorldPaused: () => false } : require(n)) });
  const html = renderToStaticMarkup(createElement(m.exports.ShortsStrip, { shorts: [{ videoId: "abcdefghijk", title: "Old", hook: "", capturedAt: "", views24: 1, views48: null, medianViews: null, changePct: null, verdict: null, flopped24: true, retryState: "replaced by retry", canRestore: true }], onRestore() {} }));
  assert.match(html, /flopped \(24h\)/); assert.match(html, /replaced by retry/); assert.match(html, />Restore</);
  assert.match(html, /48h results pending/); assert.doesNotMatch(html, /0 views at 48h/);
});

test("review queue names the original and sends its exact video id only with the owner's approval action", async () => {
  const c = oldClip(); c.status = "ready"; c.publish = undefined; c.retryOf = { clipId: "clip-2", videoId: "lmnopqrstuv", title: "Previous Short" };
  let stateIndex = 0; const sent: any[] = [], m = { exports: {} as any };
  const items = [{ job: "abcdef-123456", source: "source.mp4", base: clipPure.baseEdit(makeJob([c]).options), clip: c }];
  runInNewContext(compile("components/ReviewQueue.tsx"), { module: m, exports: m.exports,
    fetch: async (_url: string, init: any) => { sent.push(JSON.parse(init.body)); return Response.json({ clip: { ...c, status: "approved" } }); },
    require: (n: string) => {
      if (n === "react") return { ...require(n), useState: (x: any) => [stateIndex++ === 0 ? items : x, () => {}], useEffect() {}, useRef: (x: any) => ({ current: x }) };
      if (n.endsWith("clips/format")) return { CAPTION_STYLES: ["karaoke"], CAM_NAME: { left: "Left" }, LAYOUT_NAME: { fit: "Fit" }, REJECT_REASONS: [], mmss: () => "00:20" };
      if (n.endsWith("ClipPicks")) return { __esModule: true, default: () => null };
      if (n.endsWith("HypeScore")) return {};
      if (n.endsWith("world-paused")) return { useWorldPaused: () => false };
      return require(n);
    },
  });
  const tree = m.exports.default({ reduced: true, onClose() {} });
  const { renderToStaticMarkup } = await import("react-dom/server");
  assert.match(renderToStaticMarkup(tree), /Retry of Previous Short/);
  assert.match(renderToStaticMarkup(tree), /Approving allows the old Short to become private/);
  const find = (node: any): any => {
    if (!node) return null;
    if (Array.isArray(node)) { for (const n of node) { const result = find(n); if (result) return result; } return null; }
    if (node.type === "button" && node.props["aria-label"]?.includes("replace original after publication")) return node;
    return find(node.props?.children);
  };
  assert.equal(sent.length, 0);
  await find(tree).props.onClick();
  assert.deepEqual(sent, [{ status: "approved", replaceOriginal: "lmnopqrstuv" }]);
});
