import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVideo, framesFor, isMp4, parseVideoHistory, parseVideoQueued, videoQualityOf, videoSize, videoWorkflow, VIDEO_FILES } from "../src/lib/video-pure.ts";
import { assetName } from "../src/lib/local-ai-pure.ts";
import { decide, EGRESS_CLASS, TIERS } from "../src/lib/policy-pure.ts";
import { coreToolRefusal, STARTS_WORK } from "../src/lib/stop-all-pure.ts";
import { EFFECTS } from "../src/lib/approval-pure.ts";
import { readFileSync } from "node:fs";

const base = { prompt: "a fox runs", width: 832, height: 480, length: 121, seed: 5 };

test("fast text→video graph: GGUF loaders, FastWan LoRA, 4 steps cfg 1, tiled decode, mp4", () => {
  const g = videoWorkflow({ ...base, quality: "fast" });
  assert.deepEqual(g["37"].inputs, { unet_name: VIDEO_FILES.unet });
  assert.deepEqual(g["38"].inputs, { clip_name: VIDEO_FILES.clip, type: "wan" });
  assert.deepEqual(g["40"].inputs, { model: ["37", 0], lora_name: VIDEO_FILES.lora, strength_model: 1 });
  assert.deepEqual(g["48"].inputs, { model: ["40", 0], shift: 8 });
  assert.equal(g["56"], undefined);
  assert.equal("start_image" in g["55"].inputs, false);
  assert.deepEqual(g["55"].inputs, { vae: ["39", 0], width: 832, height: 480, length: 121, batch_size: 1 });
  assert.deepEqual([g["3"].inputs.steps, g["3"].inputs.cfg, g["3"].inputs.sampler_name, g["3"].inputs.scheduler, g["3"].inputs.seed], [4, 1, "euler", "simple", 5]);
  assert.deepEqual(g["8"].inputs, { samples: ["3", 0], vae: ["39", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
  assert.deepEqual(g["57"].inputs, { images: ["8", 0], fps: 24 });
  assert.deepEqual(g["58"].inputs, { video: ["57", 0], filename_prefix: "orbit/video", format: "mp4", "format.codec": "h264" });
  assert.equal(g["6"].inputs.text, "a fox runs");
});

test("image→video adds LoadImage + start_image; best drops the LoRA and uses 20 steps, cfg 5, uni_pc", () => {
  const g = videoWorkflow({ ...base, quality: "best", image: "pic.png" });
  assert.deepEqual(g["56"], { class_type: "LoadImage", inputs: { image: "pic.png" } });
  assert.deepEqual(g["55"].inputs.start_image, ["56", 0]);
  assert.equal(g["40"], undefined);
  assert.deepEqual(g["48"].inputs, { model: ["37", 0], shift: 8 });
  assert.deepEqual([g["3"].inputs.steps, g["3"].inputs.cfg, g["3"].inputs.sampler_name], [20, 5, "uni_pc"]);
  for (const n of Object.values(g)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(g[String(v[0])], `dangling ${v}`);
});

test("sizes are multiples of 32, frames are 4n+1 and clamped to 2-5 s", () => {
  assert.deepEqual(videoSize("16:9"), [832, 480]);
  assert.deepEqual(videoSize("9:16"), [480, 832]);
  assert.deepEqual(videoSize("16:9", true), [1280, 704]);
  for (const [w, h] of [videoSize("16:9"), videoSize("9:16", true)]) assert.ok(w % 32 === 0 && h % 32 === 0);
  assert.equal(framesFor(5), 121);
  assert.equal(framesFor(99), 121);
  assert.equal(framesFor(0), 49);
  assert.equal(framesFor(NaN), 121);
  for (const s of [2, 2.5, 3, 3.3, 4, 5]) assert.equal((framesFor(s) - 1) % 4, 0);
  assert.equal(videoQualityOf(" BEST "), "best");
  assert.equal(videoQualityOf("x"), "fast");
});

test("checkVideo: prompt length, picture type, seconds clamp, aspect", () => {
  assert.deepEqual(checkVideo({ prompt: "  a fox   runs ", seconds: 9, quality: "best", aspect: "9:16", name: "fox", image: "fox.PNG" }),
    { prompt: "a fox runs", image: "fox.PNG", seconds: 5, quality: "best", aspect: "9:16", name: "fox" });
  assert.deepEqual(checkVideo({ prompt: "abc", seconds: "1" }), { prompt: "abc", image: "", seconds: 2, quality: "fast", aspect: "16:9", name: "" });
  assert.ok("error" in checkVideo({ prompt: "x" }));
  assert.ok("error" in checkVideo({ prompt: "x".repeat(1001) }));
  assert.ok("error" in checkVideo({ prompt: "a fox", image: "notes.txt" }));
});

test("queue and history parsing: missing models → setup hint, mp4 under images, wrong output or OOM is an error", () => {
  assert.deepEqual(parseVideoQueued({ prompt_id: "p1", node_errors: {} }), { id: "p1" });
  const miss = parseVideoQueued({ error: { type: "invalid_prompt", message: "Cannot execute because node UnetLoaderGGUF does not exist." } }) as { error: string };
  assert.match(miss.error, /setup\.ps1 -Model wan22-video/);
  const val = parseVideoQueued({ node_errors: { "37": { errors: [{ message: "Value not in list", details: "unet_name: 'x' not in []" }] } } }) as { error: string };
  assert.match(val.error, /-Model wan22-video/);
  assert.equal((parseVideoQueued({ error: "boom" }) as { error: string }).error, "boom");
  const ok = { p1: { status: { completed: true }, outputs: { "58": { images: [{ filename: "video_00001_.mp4", subfolder: "orbit", type: "output" }], animated: [true] } } } };
  assert.deepEqual(parseVideoHistory(ok, "p1"), { state: "done", video: { filename: "video_00001_.mp4", subfolder: "orbit", type: "output" } });
  assert.equal(parseVideoHistory({}, "p1").state, "pending");
  const png = { p1: { outputs: { "9": { images: [{ filename: "a.png", type: "output" }] } } } };
  assert.equal(parseVideoHistory(png, "p1").state, "error");
  assert.equal(parseVideoHistory({ p1: { status: { completed: true }, outputs: {} } }, "p1").state, "error");
  const oom = parseVideoHistory({ p1: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "p1");
  assert.match((oom as { error: string }).error, /out of memory/);
});

test("mp4 sniffing and VAULT name", () => {
  assert.ok(isMp4(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0])));
  assert.ok(!isMp4(new Uint8Array(20)));
  assert.equal(assetName("a fox runs", "mp4", "video"), "a-fox-runs.mp4");
});

test("local_video policy: T2 local write, no approval, Stop-all refuses and lists it, prompts never carry private text to models", () => {
  const ctx = { question: "animate my fox picture", steps: [], attach: false, pins: false, stopAll: false };
  assert.equal(TIERS.local_video, "T2");
  assert.equal(EGRESS_CLASS.local_video, "model");
  assert.equal(decide("local_video", { prompt: "a fox runs" }, ctx).allow, true);
  assert.equal(decide("local_video", { prompt: "a fox runs" }, { ...ctx, stopAll: true }).allow, false);
  assert.match(coreToolRefusal(true, "local_video"), /paused/);
  assert.ok(STARTS_WORK.includes("local_video"));
  assert.equal(EFFECTS.local_video, "reversible");
});

test("setup.ps1 wan22-video branch pins the repos, revisions and files used by the graph", () => {
  const ps = readFileSync(new URL("../tools/comfyui/setup.ps1", import.meta.url), "utf8");
  for (const f of [VIDEO_FILES.unet, VIDEO_FILES.clip, VIDEO_FILES.vae, VIDEO_FILES.lora]) assert.ok(ps.includes(f), f);
  for (const pin of ["6ea2651e7df66d7585f6ffee804b20e92fb38b8a", "57437632ddd08bdcbd1508c866aa22e126ed51d2", "b535255bee98c2b0a59ea7c0ae2dcd0c6657b3b7",
    "5df3a4a3ed0628002308022198249dbbbd045d09", "8260d429d19fd7a72304cad059160b95d843913f", "355f6bee35c4c6cbd0f275112619fe8ac6f7b9b067b885723667b3bde29497c3"]) assert.ok(ps.includes(pin), pin);
  assert.match(ps, /ValidateSet\("sdxl-lightning", "nitrofusion2", "acestep-music", "wan22-video", "flux2-klein-edit"\)/);
});
