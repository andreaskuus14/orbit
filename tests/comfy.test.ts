import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODEL, PHOTO, STEPS, checkImage, comfyUrl, parseHistory, parseQueued, parseStats, seedOf, sizeFor, viewPath, workflow } from "../src/lib/comfy-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";
import { coreToolRefusal } from "../src/lib/stop-all-pure.ts";
import { EFFECTS } from "../src/lib/approval-pure.ts";

test("workflow: fixed SDXL-Lightning graph with size, seed and 4 steps; tools/comfyui/workflow-txt2img.json is the same graph", () => {
  const w = workflow({ prompt: "a red barn", width: 1344, height: 768, seed: 7 });
  assert.equal(w["4"].inputs.ckpt_name, MODEL.file);
  assert.deepEqual(w["5"].inputs, { width: 1344, height: 768, batch_size: 1 });
  assert.equal(w["6"].inputs.text, "a red barn");
  assert.deepEqual([w["3"].inputs.seed, w["3"].inputs.steps, w["3"].inputs.cfg, w["3"].inputs.sampler_name, w["3"].inputs.scheduler], [7, STEPS, 1, "euler", "sgm_uniform"]);
  assert.equal(w["9"].class_type, "SaveImage");
  const file = JSON.parse(readFileSync(new URL("../tools/comfyui/workflow-txt2img.json", import.meta.url), "utf8"));
  assert.deepEqual(file, workflow({ prompt: `a sunny oak-panelled reading room with plants. ${PHOTO}`, width: 1344, height: 768, seed: 42 }));
});

test("sizes and seed: SDXL buckets per aspect, odd aspect → 16:9; same text same seed", () => {
  assert.deepEqual(sizeFor("9:16"), [768, 1344]);
  assert.deepEqual(sizeFor("1:1"), [1024, 1024]);
  assert.deepEqual(sizeFor("7:3"), [1344, 768]);
  assert.equal(seedOf("img/hero.jpg"), seedOf("img/hero.jpg"));
  assert.notEqual(seedOf("a"), seedOf("b"));
});

test("service URL: this PC only, default 8188", () => {
  assert.equal(comfyUrl(undefined), "http://127.0.0.1:8188");
  assert.equal(comfyUrl("http://localhost:9000/x"), "http://localhost:9000");
  assert.equal(comfyUrl("http://192.168.1.5:8188"), null);
  assert.equal(comfyUrl("https://127.0.0.1:8188"), null);
});

test("replies: queued id, node errors (missing model named), history pending/error/done, view path", () => {
  assert.deepEqual(parseQueued({ prompt_id: "p1", number: 0, node_errors: {} }), { id: "p1" });
  assert.match((parseQueued({ error: { message: "Prompt outputs failed validation" }, node_errors: { 4: { errors: [{ message: "Value not in list", details: "ckpt_name: 'x' not in []" }] } } }) as { error: string }).error, /model file .* is missing.*setup\.ps1/);
  assert.match((parseQueued(null) as { error: string }).error, /refused/);
  assert.deepEqual(parseHistory({}, "p1"), { state: "pending" });
  assert.deepEqual(parseHistory({ p1: { status: { status_str: "success", completed: false }, outputs: {} } }, "p1"), { state: "pending" });
  const oom = parseHistory({ p1: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "p1");
  assert.equal(oom.state, "error");
  assert.match((oom as { error: string }).error, /ran out of memory/);
  const done = parseHistory({ p1: { status: { status_str: "success", completed: true }, outputs: { 9: { images: [{ filename: "orbit_00001_.png", subfolder: "", type: "output" }] } } } }, "p1");
  assert.deepEqual(done, { state: "done", image: { filename: "orbit_00001_.png", subfolder: "", type: "output" } });
  assert.equal(viewPath({ filename: "a b.png", subfolder: "", type: "output" }), "/view?filename=a+b.png&subfolder=&type=output");
  assert.equal(parseHistory({ p1: { status: { completed: true }, outputs: {} } }, "p1").state, "error");
});

test("health: system_stats → running + GPU; anything else not running", () => {
  const h = parseStats({ system: { comfyui_version: "0.3.70" }, devices: [{ name: "cuda:0 NVIDIA GeForce RTX 5060 Laptop GPU : cudaMallocAsync", type: "cuda", vram_total: 8 * 2 ** 30 }] }, true);
  assert.deepEqual(h, { running: true, installed: true, gpu: { name: "NVIDIA GeForce RTX 5060 Laptop GPU", vramGb: 8 }, version: "0.3.70" });
  assert.deepEqual(parseStats(null, false), { running: false, installed: false, gpu: null, version: "" });
});

test("local_image input and policy: T2 local write, Stop-all refuses it, reversible", () => {
  assert.deepEqual(checkImage({ prompt: "  a calm  lake ", aspect: "1:1", name: "lake" }), { prompt: "a calm lake", aspect: "1:1", name: "lake" });
  assert.equal((checkImage({ prompt: "x", aspect: "3:2" }) as { error: string }).error.length > 0, true);
  assert.equal((checkImage({ prompt: "a lake", aspect: "3:2" }) as { aspect: string }).aspect, "16:9");
  const ctx = { question: "make me a picture of a lake", steps: [], attach: false, pins: false, stopAll: false };
  assert.equal(decide("local_image", { prompt: "a lake" }, ctx).allow, true);
  assert.equal(decide("local_image", { prompt: "a lake" }, { ...ctx, stopAll: true }).allow, false);
  assert.match(coreToolRefusal(true, "local_image"), /paused/);
  assert.equal(EFFECTS.local_image, "reversible");
});
