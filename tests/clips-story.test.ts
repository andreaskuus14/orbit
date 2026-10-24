import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BATCH_TOOL, HF, approveProblem, assembleArgs, fingerprint, guardDecision, hfErrorKind, kenBurns, parseQuoteReply, parseStory, parseSubmitReply, parseWaitReply,
  quoteTotal, sceneSecs, scriptWords, silentWav, storyItems, validStory, validStoryOpts, type StoryJob,
} from "../src/lib/clips/story-pure.ts";
import { buildAss } from "../src/lib/clips/pure.ts";

const scene = (i: number) => ({ visual: `A fox in a lantern-lit forest, shot ${i}`, narration: `Line number ${i} of the tale.`, sec: 6, camera: "slow push in" });
const raw = { title: "The Last Lantern", hook: "She shouldn't have opened it", scenes: [1, 2, 3, 4, 5].map(scene) };
const opts = { idea: "a fox and a lantern", style: "watercolor", length: 45, voice: "kokoro:af_heart", motion: "stills" as const };
const models = { image: "img_m", video: "vid_m", audio: "aud_m" };

test("parseStory accepts fenced JSON and fits scene seconds to the length", () => {
  const s = parseStory("Here:\n```json\n" + JSON.stringify(raw) + "\n```", 45);
  assert.ok(typeof s !== "string");
  assert.equal(s.scenes.length, 5);
  assert.equal(Math.round(s.scenes.reduce((a, c) => a + c.sec, 0)), 45);
});

test("validStory rejects bad stories", () => {
  assert.match(String(validStory({ ...raw, scenes: raw.scenes.slice(0, 4) }, 45)), /5-9 scenes/);
  assert.match(String(validStory({ ...raw, title: "" }, 45)), /title/);
  assert.match(String(validStory({ ...raw, scenes: [...raw.scenes.slice(0, 4), { ...scene(5), narration: "" }] }, 45)), /scene 5/);
  assert.equal(typeof parseStory("no json here", 45), "string");
  const edited = validStory(raw, 45, false);
  assert.ok(typeof edited !== "string" && edited.scenes[0].sec === 6); // edits keep the owner's seconds
});

test("validStoryOpts checks idea, length, voice and motion", () => {
  assert.deepEqual(validStoryOpts({ idea: "  a fox  ", length: 30 }), { idea: "a fox", style: "", length: 30, voice: "kokoro:af_heart", motion: "stills" });
  assert.equal(typeof validStoryOpts({ idea: "x" }), "string");
  assert.equal(typeof validStoryOpts({ idea: "a fox", length: 50 }), "string");
  assert.equal(typeof validStoryOpts({ idea: "a fox", voice: "hf:bad id!" }), "string");
  assert.equal(typeof validStoryOpts({ idea: "a fox", voice: "hf:abc-123" }), "object");
});

test("storyItems: one picture per scene, Higgsfield audio only with an hf voice, never free-trial spending", () => {
  const story = validStory(raw, 45) as Exclude<ReturnType<typeof validStory>, string>;
  const local = storyItems(story, opts, models);
  assert.equal(local.length, 5);
  assert.ok(local.every((i) => i.kind === "image" && i.params.model === "img_m" && i.params.use_unlim === false && i.params.aspect_ratio === "9:16"));
  assert.match(String(local[0].params.prompt), /watercolor/);
  const hf = storyItems(story, { ...opts, voice: "hf:v1", motion: "video" }, models);
  assert.deepEqual(hf.map((i) => i.kind), [...Array(5).fill("video"), ...Array(5).fill("audio")]);
  assert.deepEqual(hf.map((i) => i.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(hf[5].params.voice_id, "v1");
});

function quoted(): StoryJob {
  const story = validStory(raw, 45) as Exclude<ReturnType<typeof validStory>, string>;
  const items = storyItems(story, opts, models).map((i) => ({ ...i, credits: 2 }));
  return { v: 1, id: "abc123-abcdef", createdAt: "", updatedAt: "", status: "quoted", step: "", opts, story, items, warnings: [],
    quote: { total: 10, balance: 50, plan: "free", fingerprint: fingerprint(story, opts), at: "" } };
}

test("approveProblem: only the exact quoted total for the exact script, with enough credits", () => {
  const j = quoted();
  assert.equal(approveProblem(j, 10), "");
  assert.match(approveProblem(j, 9), /quoted total/);
  assert.match(approveProblem(j, "10"), /quoted total/);
  assert.match(approveProblem({ ...j, quote: undefined }, 10), /cost first/);
  assert.match(approveProblem({ ...j, story: { ...j.story, title: "changed" } }, 10), /changed/);
  assert.match(approveProblem({ ...j, quote: { ...j.quote!, balance: 4 } }, 10), /Not enough/);
  assert.match(approveProblem({ ...j, status: "generating" }, 10), /already/);
  // resume: submitted items are not paid again
  j.items.slice(0, 3).forEach((i) => (i.jobId = "x"));
  assert.equal(quoteTotal(j.items), 4);
  assert.equal(approveProblem(j, 4), "");
});

test("guard: quote mode only allows price checks and balance", () => {
  const p = { mode: "quote" as const };
  assert.ok(guardDecision(p, [], HF + "generate_image", { params: { model: "m", prompt: "p", get_cost: true } }).allow);
  assert.ok(guardDecision(p, [], HF + "generate_image", { params: JSON.stringify({ model: "m", get_cost: true }) }).allow);
  assert.ok(!guardDecision(p, [], HF + "generate_image", { params: { model: "m", prompt: "p" } }).allow);
  assert.ok(!guardDecision(p, [], HF + "generate_image", { params: { model: "m", get_cost: "true" } }).allow);
  assert.ok(!guardDecision(p, [], HF + "generate_image_batch", { requests: [] }).allow);
  assert.ok(!guardDecision(p, [], HF + "tiktok_publish_status", {}).allow);
  assert.ok(guardDecision(p, [], HF + "balance", {}).allow);
});

test("guard: submit mode allows only the approved batch, once; wait mode only jobs_wait", () => {
  const requests = [{ index: 0, params: { model: "m", prompt: "a", use_unlim: false } }, { index: 1, params: { model: "m", prompt: "b", use_unlim: false } }];
  const p = { mode: "submit" as const, allow: [{ tool: BATCH_TOOL.image, requests }] };
  // same content, different order / key order / explicit count 1 / extra context: still the approved batch
  const sent = { context: "story", requests: [{ params: { prompt: "b", model: "m", use_unlim: false, count: 1 }, index: 1 }, requests[0]] };
  const d = guardDecision(p, [], BATCH_TOOL.image, sent);
  assert.deepEqual([d.allow, d.use], [true, 0]);
  assert.ok(!guardDecision(p, [0], BATCH_TOOL.image, sent).allow, "a second send is blocked");
  assert.ok(!guardDecision(p, [], BATCH_TOOL.image, { requests: [requests[0]] }).allow);
  assert.ok(!guardDecision(p, [], BATCH_TOOL.image, { requests: [{ ...requests[0], params: { ...requests[0].params, model: "pricey" } }, requests[1]] }).allow);
  assert.ok(!guardDecision(p, [], BATCH_TOOL.video, { requests }).allow);
  assert.ok(guardDecision({ mode: "wait" }, [], HF + "jobs_wait", {}).allow);
  assert.ok(!guardDecision({ mode: "wait" }, [], BATCH_TOOL.image, { requests }).allow);
});

test("hf-guard hook script: exit 0 allows, exit 2 blocks, and a batch can't be sent twice", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hfg-"));
  try {
    const policy = path.join(dir, "p.json"), requests = [{ index: 0, params: { model: "m", prompt: "a" } }];
    writeFileSync(policy, JSON.stringify({ mode: "submit", allow: [{ tool: BATCH_TOOL.image, requests }] }));
    const run = (ev: unknown) => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/hf-guard.ts", policy], { input: JSON.stringify(ev), encoding: "utf8" });
    const ev = { tool_name: BATCH_TOOL.image, tool_input: { requests } };
    assert.equal(run(ev).status, 0);
    const again = run(ev);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /ORBIT blocked/);
    assert.equal(run({ tool_name: "Bash", tool_input: {} }).status, 2);
    assert.equal(spawnSync(process.execPath, ["--experimental-strip-types", "scripts/hf-guard.ts", path.join(dir, "missing.json")], { input: "{}" }).status, 2, "fails closed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("reply parsers", () => {
  assert.deepEqual(parseQuoteReply('{"balance":40,"plan":"Free","items":[{"key":"image-0","credits":2},{"key":"image-1","credits":2.5}]}', ["image-0", "image-1"]),
    { ok: { balance: 40, plan: "Free", credits: { "image-0": 2, "image-1": 2.5 } } });
  assert.match(JSON.stringify(parseQuoteReply('{"items":[{"key":"image-0","credits":2}]}', ["image-0", "image-1"])), /No price for image-1/);
  assert.deepEqual(parseQuoteReply('{"error":{"kind":"not_connected","message":"no tools"}}', []), { error: { kind: "not_connected", message: "no tools" } });
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.deepEqual(parseSubmitReply(`{"jobs":[{"index":0,"job_id":"${id}"},{"index":1,"job_id":"nope"}],"error":{"message":"insufficient credits"}}`),
    { jobs: { 0: id }, error: { kind: "credits", message: "insufficient credits" } });
  const w = parseWaitReply('{"jobs":[{"index":0,"status":"completed","url":"https://cdn.x/a.png"},{"index":1,"status":"in_progress"},{"index":2,"status":"completed","url":"http://x"},{"index":3,"status":"failed","error":"nsfw"}]}');
  assert.ok("ok" in w);
  assert.deepEqual(w.ok.map((s) => s.status), ["done", "pending", "failed", "failed"]);
  assert.equal(w.ok[0].url, "https://cdn.x/a.png");
});

test("hfErrorKind", () => {
  assert.equal(hfErrorKind("Tool mcp__higgsfield__balance not available"), "not_connected");
  assert.equal(hfErrorKind("Insufficient credits for this generation"), "credits");
  assert.equal(hfErrorKind("This model requires a paid plan, please upgrade"), "paid_plan");
  assert.equal(hfErrorKind("boom"), "other");
});

test("timing helpers", () => {
  assert.deepEqual(sceneSecs([5, 5], [6.1, null]), [6.5, 5]);
  const w = scriptWords(["one two", "three"], [0, 5], [2, 1]);
  assert.deepEqual(w.map((x) => x.text), ["one", "two", "three"]);
  assert.equal(w[0].start, 0);
  assert.equal(w[2].start, 5);
  assert.equal(kenBurns("pull out", 100).z, "1.15-0.15*(on/99)");
  assert.equal(silentWav(1, 8000).length, 44 + 16000);
});

// Runs the real filter graph through ffmpeg (ORBIT_FFMPEG, else ffmpeg on PATH); skipped when there is none.
const ff = process.env.ORBIT_FFMPEG || "ffmpeg";
const hasFf = spawnSync(ff, ["-version"]).status === 0;
test("assembleArgs renders a 1080x1920 Short with crossfades, narration, music and captions", { skip: !hasFf && "no ffmpeg" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "story-"));
  try {
    const mk = (args: string[]) => assert.equal(spawnSync(ff, ["-y", "-hide_banner", "-loglevel", "error", ...args], { cwd: dir }).status, 0);
    mk(["-f", "lavfi", "-i", "color=c=red:s=640x480", "-frames:v", "1", "a.png"]);
    mk(["-f", "lavfi", "-i", "testsrc2=s=320x240:d=1", "b.mp4"]);
    mk(["-f", "lavfi", "-i", "sine=f=440:d=1", "n.wav"]);
    mk(["-f", "lavfi", "-i", "sine=f=220:d=1", "m.wav"]);
    writeFileSync(path.join(dir, "c.ass"), buildAss({ hook: "Hook", words: scriptWords(["one two three"], [0], [2]), duration: 3 }));
    const args = assembleArgs({ scenes: [{ file: "a.png", video: false, sec: 1.5, camera: "pan left", narration: "n.wav" }, { file: "b.mp4", video: true, sec: 1.5, camera: "" }], music: "m.wav", ass: "c.ass", out: "o.mp4" });
    const r = spawnSync(ff, args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const probe = spawnSync(ff, ["-hide_banner", "-i", "o.mp4"], { cwd: dir, encoding: "utf8" }).stderr;
    assert.match(probe, /1080x1920/);
    assert.match(probe, /Duration: 00:00:03/);
    assert.match(probe, /Audio: aac/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
