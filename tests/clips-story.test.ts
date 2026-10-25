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

// ---- talking drama ----
import { DRAMA_DEFAULT, DRAMA_SYSTEM, dialogueAss, dramaArgs, dramaItems, lineTimes, mergeItems, narrated, payable, rankTitles, redoItem, shotCast, submittable, thumbAss, thumbShots, unpaid, validDrama } from "../src/lib/clips/story-pure.ts";

const shot = (i: number, speaker = i % 2 ? "Sara" : "Ben") => ({ setting: "A modern living room, warm lamp light", action: `Sara and Ben on the couch, beat ${i}`, camera: "close-up",
  speaker, line: "I thought we were happy.", beat: "hurt", sec: 5 });
const drama = { title: "She saw the messages", hook: "a very sad story", characters: [
  { name: "Sara", look: "strawberry head, green leafy hair, white hoodie", voice: "young woman, soft" },
  { name: "Ben", look: "banana head, grey t-shirt, jeans", voice: "young man, nervous" }], shots: [1, 2, 3, 4, 5, 6].map((i) => shot(i)) };

test("validDrama: characters, speakers, shot seconds, line length and total", () => {
  const d = validDrama(drama);
  assert.ok(typeof d !== "string", String(d));
  assert.equal(d.scenes.length, 6);
  assert.equal(d.scenes[0].narration, "I thought we were happy.");
  assert.equal(d.scenes[1].speaker, "Ben");
  assert.match(d.scenes[0].visual, /living room.*couch/);
  assert.match(String(validDrama({ ...drama, characters: drama.characters.slice(0, 1) })), /2-3 characters/);
  assert.match(String(validDrama({ ...drama, shots: drama.shots.slice(0, 4) })), /5-7 shots/);
  assert.match(String(validDrama({ ...drama, shots: [...drama.shots.slice(1), shot(1, "Mia")] })), /speaker must be one of Sara, Ben/);
  assert.match(String(validDrama({ ...drama, shots: [...drama.shots.slice(1), { ...shot(1), line: "word ".repeat(10) }] })), /max 9 words/);
  assert.match(String(validDrama({ ...drama, shots: [...drama.shots.slice(1), { ...shot(1), line: "She said she never loved him." }] })), /third person/);
  assert.ok(narrated("Sara is so tired of this.", "Sara") && narrated("He knew it was over.", "Ben") && !narrated("I saw the messages, Ben.", "Sara"));
  const h = validDrama({ ...drama, hooks: ["Who is Kiwi?", "I thought we were happy.", "She told me everything about you."] }) as Exclude<ReturnType<typeof validDrama>, string>;
  assert.deepEqual(h.hooks, ["I thought we were happy.", "Who is Kiwi?"], "shot 1's line first; duplicates and narration dropped");
  assert.match(String(validDrama({ ...drama, shots: drama.shots.slice(0, 5).map((s) => ({ ...s, sec: 4 })) })), /add up to 20 s/);
  const long = validDrama({ ...drama, shots: [...drama.shots.slice(1), { ...shot(1), sec: 9 }] });
  assert.ok(typeof long !== "string" && long.scenes[5].sec === 6, "shots clamp to 4-6 whole seconds");
  // the owner's saved edits (Story shape) round-trip, even when short
  const edited = validDrama({ ...d, scenes: d.scenes.slice(0, 5).map((s) => ({ ...s, sec: 4 })) }, false);
  assert.ok(typeof edited !== "string" && edited.scenes.length === 5 && edited.scenes[0].sec === 4);
  assert.match(DRAMA_SYSTEM, /FRUIT heads/);
  assert.match(DRAMA_SYSTEM, /most emotional line/);
  assert.equal((validDrama({ ...drama, titles: ["A", "B", "C", "D"] }) as { titles: string[] }).titles.length, 3);
  assert.deepEqual((validDrama({ ...drama, title: "", titles: ["A", "B"] }) as { title: string; titles: string[] }).title, "A");
});

test("validStoryOpts: drama format picks a talking model", () => {
  const o = validStoryOpts({ idea: "she finds messages on his phone", format: "drama" });
  assert.deepEqual(o, { idea: "she finds messages on his phone", style: "", length: 45, voice: "none", motion: "video", format: "drama", model: DRAMA_DEFAULT });
  assert.equal(typeof validStoryOpts({ idea: "a fox", format: "drama", model: "nope" }), "string");
  assert.equal(typeof validStoryOpts({ idea: "a fox", format: "musical" }), "string");
});

test("dramaItems: a reference image per character, then talking shots that reference the cast and the speaker's first voice", () => {
  const d = validDrama({ ...drama, shots: [...drama.shots.slice(0, 5), { ...shot(6, "Ben"), action: "Ben alone in the kitchen" }] }) as Exclude<ReturnType<typeof validDrama>, string>;
  const o = validStoryOpts({ idea: "x x x", format: "drama", model: "gemini_omni_flash_1_1" }) as Exclude<ReturnType<typeof validStoryOpts>, string>;
  const items = dramaItems(d, o, models);
  assert.deepEqual(items.map((i) => i.key), ["char-0", "char-1", "video-0", "video-1", "video-2", "video-3", "video-4", "video-5"]);
  assert.deepEqual(items.map((i) => i.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(items[0].params.model, "img_m");
  const v = items[2];
  assert.equal(v.params.model, "gemini_omni_flash_1_1");
  assert.equal(v.params.mode, "reference-to-video");
  assert.equal(v.params.duration, 5);
  assert.equal(v.params.use_unlim, false);
  assert.match(String(v.params.prompt), /Sara says \(hurt\), in a young woman, soft voice: "I thought we were happy\."/);
  assert.deepEqual(v.refs, ["char-0", "char-1"]);
  assert.deepEqual(items[7].refs, ["char-1"], "a shot shows only who is in it");
  assert.deepEqual(shotCast(d.scenes[5], d.characters!).map((c) => c.name), ["Ben"]);
  assert.ok(items.every((i) => !i.after), "gemini takes no audio references");
  const seed = dramaItems(d, { ...o, model: undefined }, models);
  assert.equal(seed[2].params.generate_audio, true);
  assert.deepEqual(seed.map((i) => i.after), [undefined, undefined, undefined, undefined, "video-0", "video-1", "video-0", "video-1"], "later shots reuse the speaker's first voice");
});

test("drama spend: character images are approved first, shots only after they exist; voice references go in a later round", () => {
  const d = validDrama(drama) as Exclude<ReturnType<typeof validDrama>, string>;
  const o = validStoryOpts({ idea: "x x x", format: "drama" }) as Exclude<ReturnType<typeof validStoryOpts>, string>;
  const items = dramaItems(d, o, models);
  assert.deepEqual(payable(items).map((i) => i.key), ["char-0", "char-1"], "step 1: only the cheap character images can be priced");
  items.forEach((i) => (i.credits = i.kind === "image" ? 1 : 10));
  assert.equal(quoteTotal(items), 2, "the first Approve covers only the images");
  Object.assign(items[0], { jobId: "j0", status: "done" });
  assert.deepEqual(payable(items).map((i) => i.key), ["char-1"], "no shot before all its characters exist");
  Object.assign(items[1], { jobId: "j1", status: "done" });
  assert.equal(payable(items).length, 6);
  assert.equal(quoteTotal(items), 60);
  const shots = payable(items);
  const round1 = submittable(shots, items);
  assert.deepEqual(round1.map((i) => i.key), ["video-0", "video-1"]);
  assert.deepEqual(items[2].params.medias, [{ role: "image_references", value: "j0" }, { role: "image_references", value: "j1" }]);
  Object.assign(items[2], { jobId: "s0", status: "done" });
  Object.assign(items[3], { jobId: "s1", status: "done" });
  const round2 = submittable(unpaid(items), items);
  assert.equal(round2.length, 4);
  assert.deepEqual(items[4].params.medias, [{ role: "image_references", value: "j0" }, { role: "image_references", value: "j1" }, { role: "audio_references", value: "s0" }]);
});

test("redoItem: regenerate one shot or an unused character, priced alone", () => {
  const d = validDrama(drama) as Exclude<ReturnType<typeof validDrama>, string>;
  const o = validStoryOpts({ idea: "x x x", format: "drama" }) as Exclude<ReturnType<typeof validStoryOpts>, string>;
  const items = dramaItems(d, o, models).map((i) => ({ ...i, jobId: `j${i.index}`, status: "done" as const, file: `/x/${i.key}.mp4`, credits: 5 }));
  const job: StoryJob = { v: 1, id: "abc123-abcdef", createdAt: "", updatedAt: "", status: "done", step: "", opts: o, story: d, items, warnings: [], quote: { total: 0, balance: 9, plan: null, fingerprint: "", at: "" } };
  assert.match(redoItem(job, "char-0"), /Shots already use/);
  assert.match(redoItem(job, "nope"), /Nothing made/);
  assert.match(redoItem({ ...job, status: "generating" }, "video-3"), /being made/);
  assert.equal(redoItem(job, "video-3"), "");
  assert.equal(job.status, "draft");
  assert.equal(job.quote, undefined);
  assert.deepEqual(payable(job.items).map((i) => i.key), ["video-3"], "only that shot is priced and paid again");
  const fresh = dramaItems(d, o, models).map((i) => (i.kind === "image" ? { ...i, jobId: "c", status: "done" as const } : i));
  const j2: StoryJob = { ...job, status: "draft", items: fresh };
  assert.equal(redoItem(j2, "char-1"), "", "a character can be redone before the shots are made");
});

test("mergeItems: an edit keeps made, unchanged items and re-pays only what changed", () => {
  const d = validDrama(drama) as Exclude<ReturnType<typeof validDrama>, string>;
  const o = validStoryOpts({ idea: "x x x", format: "drama" }) as Exclude<ReturnType<typeof validStoryOpts>, string>;
  const made = dramaItems(d, o, models).map((i) => ({ ...i, jobId: `j${i.index}`, status: "done" as const, file: `/x/${i.key}` }));
  made[2].params = { ...made[2].params, medias: [{ role: "image_references", value: "j0" }] };
  const line = { ...d, scenes: d.scenes.map((s, i) => (i === 4 ? { ...s, narration: "You lied to me." } : s)) };
  const a = mergeItems(made, dramaItems(line, o, models));
  assert.deepEqual(payable(a).map((i) => i.key), ["video-4"], "a changed line re-makes only that shot");
  assert.equal(a[2].file, "/x/video-0", "made shots keep their files (no new credits)");
  const look = { ...d, characters: d.characters!.map((c, i) => (i === 1 ? { ...c, look: "pineapple head" } : c)) };
  const b = mergeItems(made, dramaItems(look, o, models));
  assert.deepEqual(unpaid(b).map((i) => i.key), ["char-1", "video-0", "video-1", "video-2", "video-3", "video-4", "video-5"], "a new look re-makes that character and every shot showing it");
  assert.deepEqual(payable(b).map((i) => i.key), ["char-1"]);
});

test("packaging: emotional thumbnails, ranked titles, thumbnail text", () => {
  const d = validDrama({ ...drama, shots: drama.shots.map((s, i) => (i === 3 ? { ...s, beat: "tears, shock" } : i === 1 ? { ...s, camera: "wide" } : s)) }) as Exclude<ReturnType<typeof validDrama>, string>;
  const t = thumbShots(d.scenes);
  assert.equal(t.length, 3);
  assert.equal(t[0], 3, "a close-up crying beats the rest");
  assert.ok(!t.includes(1), "a wide shot is not picked");
  const titles = rankTitles(["She checked his phone", "I trusted the wrong person", "The text that ended it"]);
  assert.equal(titles.length, 3);
  assert.ok(titles.every((x) => x.text && Number.isFinite(x.score)));
  assert.match(thumbAss("a very sad story"), /,T,,0,0,0,,A VERY SAD STORY/);
});

test("drama subtitles and line timing", () => {
  assert.deepEqual(lineTimes(10, 5), { start: 10.2, end: 14.9 });
  assert.deepEqual(lineTimes(10, 5, [{ start: 0.6, end: 1 }, { start: 1.1, end: 2.2 }]), { start: 10.5, end: 12.6 });
  const ass = dialogueAss([{ text: "I saw {the} messages.", start: 0.2, end: 4.9 }], "a very sad story");
  assert.match(ass, /Style: Line,Arial,54,&H00FFFFFF/);
  assert.match(ass, /Dialogue: 0,0:00:00.20,0:00:04.90,Line,,0,0,0,,I saw \(the\) messages\./);
  assert.match(ass, /Hook,,0,0,0,,a very sad story/);
  assert.doesNotMatch(dialogueAss([{ text: "x", start: 0, end: 1 }]), /,Hook,,/);
});

test("dramaArgs renders hard cuts with each shot's own audio, a ducked music bed and subtitles", { skip: !hasFf && "no ffmpeg" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "drama-"));
  try {
    const mk = (args: string[]) => assert.equal(spawnSync(ff, ["-y", "-hide_banner", "-loglevel", "error", ...args], { cwd: dir }).status, 0);
    mk(["-f", "lavfi", "-i", "testsrc2=s=360x640:d=1.2", "-f", "lavfi", "-i", "sine=f=440:d=1.2", "-shortest", "a.mp4"]);
    mk(["-f", "lavfi", "-i", "testsrc2=s=360x640:d=1", "b.mp4"]); // no audio
    mk(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", "c.png"]); // dry-run still
    mk(["-f", "lavfi", "-i", "sine=f=220:d=1", "m.mp3"]);
    writeFileSync(path.join(dir, "c.ass"), dialogueAss([{ text: "I thought we were happy.", start: 0.1, end: 1 }], "hook"));
    const args = dramaArgs({ shots: [{ file: "a.mp4", sec: 1.2, audio: true }, { file: "b.mp4", sec: 1, audio: false }, { file: "c.png", sec: 0.8, audio: false }], music: "m.mp3", ass: "c.ass", out: "o.mp4" });
    assert.ok(!args.join(" ").includes("xfade") && !args.join(" ").includes("zoompan"), "hard cuts, no Ken Burns");
    const r = spawnSync(ff, args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const probe = spawnSync(ff, ["-hide_banner", "-i", "o.mp4"], { cwd: dir, encoding: "utf8" }).stderr;
    assert.match(probe, /1080x1920/);
    assert.match(probe, /Duration: 00:00:03\.[45]/, "3 s of shots + the 0.5 s end hold");
    assert.match(probe, /Audio: aac/);
    assert.ok(args.join(" ").includes("loudnorm=I=-14"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
