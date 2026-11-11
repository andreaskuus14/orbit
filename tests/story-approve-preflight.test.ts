import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as crypto from "node:crypto";
import path from "node:path";
import ts from "typescript";
import * as hfPure from "../src/lib/higgsfield-pure.ts";
import * as storyPure from "../src/lib/clips/story-pure.ts";

// approveStory (src/lib/clips/story.ts): a Short that can't be rendered (no ffmpeg) must be refused BEFORE the approval is recorded,
// because every recorded approval counts against the weekly Higgsfield cap even when nothing was generated.
const code = ts.transpileModule(readFileSync(new URL("../src/lib/clips/story.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function load(ffmpeg: string | null) {
  const saved: storyPure.StoryJob[] = [], ran: string[] = [];
  const m = { exports: {} as Record<string, any> };
  const stubs: Record<string, unknown> = {
    "../authority": { authorizeApproval: async () => "" },
    "../approval-pure": { spendContent: (f: string, c: number) => ({ f, c }) },
    "./kokoro": { kokoroTts: async () => ({}) }, "./music": { pickMusic: async () => null },
    "../claude": { MODEL: "m", askClaude: async () => ({ text: "" }), emitAsOwner: async () => {} },
    "./factory": { ffmpegPath: async () => ffmpeg, clipsDir: () => "/x/clips", studioRoot: () => "/x", readState: async () => null, runFfmpeg: async () => "", saveJob: async () => {}, transcribe: async () => [],
      saveState: async (_id: string, _f: string, j: storyPure.StoryJob) => { saved.push(structuredClone(j)); } },
    "./higgsfield": { higgsfield: () => ({}) },
    "./story-render": { generate: async () => {}, makeStory: async () => { ran.push("render"); return null; }, StoryError: Error },
    "../higgsfield-pure": hfPure, "./story-pure": storyPure,
    "../stop-all": { stopAllOn: () => false }, "../stop-all-pure": { PAUSED_MSG: "paused" }, "../remote-push": { pushNotify: () => {} },
    "../core-studio": { errText: String }, "../activity": { logActivity: () => {} }, "../site-pictures-pure": {}, "./pure": { STATE_V: 1 },
    "../autonomy": { allows: () => ({ ok: true }) },
    "node:crypto": crypto, "node:fs/promises": { mkdir: async () => {}, readdir: async () => [], rm: async () => {} }, "node:path": { default: path, ...path },
  };
  runInNewContext(code, { module: m, exports: m.exports, process: { env: {} }, structuredClone, setTimeout, AbortController, Promise,
    require: (n: string) => { if (!(n in stubs)) throw new Error(`unstubbed ${n}`); return stubs[n]; } });
  return { s: m.exports, saved, ran };
}

function quotedJob(): storyPure.StoryJob {
  const story = { title: "T", hook: "h", scenes: [1, 2, 3, 4, 5].map((i) => ({ visual: `scene ${i}`, narration: "Words here.", sec: 6, camera: "pan left" })) };
  const opts: storyPure.StoryOpts = { idea: "idea", style: "", length: 30, voice: "none", motion: "stills" };
  const items = storyPure.storyItems(story, opts, { image: "i", video: "v", audio: "a" });
  items.forEach((i) => (i.credits = 2));
  const at = new Date().toISOString();
  return { v: 1, id: "abc123-0a0b0c", createdAt: at, updatedAt: at, status: "quoted", step: "", opts, story, items, warnings: [],
    quote: { total: storyPure.quoteTotal(items), balance: 100, plan: "p", fingerprint: storyPure.fingerprint(story, opts), at } };
}

test("no ffmpeg: Approve is refused and nothing is recorded against the weekly cap", async () => {
  const { s, saved, ran } = load(null);
  const job = quotedJob();
  const r = await s.approveStory(job, job.quote!.total, "seen");
  assert.equal(typeof r, "string");
  assert.match(r, /ffmpeg not found.*Nothing was approved or spent/);
  assert.equal(job.approved, undefined, "the approval is not recorded");
  assert.equal(saved.length, 0, "the job isn't saved as generating");
  assert.equal(ran.length, 0);
  assert.equal(hfPure.weekSpent(job.approved ?? [], Date.now()), 0);
});

test("with ffmpeg: Approve is recorded once and the render starts", async () => {
  const { s, saved } = load("/usr/bin/ffmpeg");
  const job = quotedJob();
  const r = await s.approveStory(job, job.quote!.total, "seen");
  assert.notEqual(typeof r, "string", String(r));
  assert.equal(job.approved?.length, 1);
  assert.equal(job.approved?.[0].credits, 10);
  assert.equal(saved[0]?.status, "generating");
});
