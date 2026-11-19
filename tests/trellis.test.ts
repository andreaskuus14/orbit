import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, ROBLOX, glbMaterials, isGlb, robloxMaterials, jobPrefix, outputRef, parseQueued, parseRun, qualityOf, trellisUrl, workflow } from "../src/lib/trellis-pure.ts";

test("workflow: background cut, TRELLIS.2 GGUF in low-VRAM mode, mesh capped to Roblox limits, glb export under orbit3d/", () => {
  const w = workflow({ image: "pet.png", seed: 42, job: "j123" });
  assert.equal(w["1"].inputs.image, "pet.png");
  assert.equal(w["2"].inputs.remove_background, true);
  assert.deepEqual([w["3"].inputs.modelname, w["3"].inputs.model_format, w["3"].inputs.low_vram, w["3"].inputs.keep_models_loaded], [MODEL.name, MODEL.format, true, false]);
  assert.deepEqual(w["4"].inputs.image, ["2", 0]);
  assert.equal(w["4"].inputs.seed, 42);
  assert.deepEqual([w["5"].inputs.mesh, w["5"].inputs.bvh], [["4", 0], ["4", 1]]);
  assert.equal(w["5"].inputs.target_face_num, ROBLOX.maxFaces);
  assert.equal(w["5"].inputs.texture_size, ROBLOX.texture);
  assert.deepEqual([w["6"].inputs.trimesh, w["6"].inputs.filename_prefix, w["6"].inputs.file_format], [["5", 0], "orbit3d/j123", "glb"]);
  // every link points at a node in the graph
  for (const n of Object.values(w)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(w[String(v[0])], `missing node ${v[0]}`);
});

test("job prefix and output: plain characters only; ComfyUI's first counter file", () => {
  assert.equal(jobPrefix("../../x y"), "orbit3d/xy");
  assert.equal(jobPrefix("!!"), "orbit3d/job");
  assert.deepEqual(outputRef("j1"), { filename: "j1_00001_.glb", subfolder: "orbit3d", type: "output" });
});

test("quality: only an explicit best picks TRELLIS.2", () => {
  assert.equal(qualityOf("best"), "best");
  assert.equal(qualityOf(" BEST "), "best");
  for (const q of [undefined, "", "fast", "high", 1]) assert.equal(qualityOf(q), "fast");
});

test("url: this PC only", () => {
  assert.equal(trellisUrl(undefined), "http://127.0.0.1:8189");
  assert.equal(trellisUrl("http://localhost:9000"), "http://localhost:9000");
  assert.equal(trellisUrl("https://example.com"), null);
  assert.equal(trellisUrl("http://192.168.1.5:8189"), null);
});

test("parseQueued: id, node error, missing node pack → setup hint", () => {
  assert.deepEqual(parseQueued({ prompt_id: "abc", node_errors: {} }), { id: "abc" });
  const e = parseQueued({ error: { message: "Cannot execute because node Trellis2LoadModel_GGUF does not exist." } });
  assert.ok("error" in e && e.error.includes("tools\\trellis\\setup.ps1"));
  const n = parseQueued({ prompt_id: "x", node_errors: { "1": { errors: [{ message: "Value not in list", details: "image: 'gone.png'" }] } } });
  assert.ok("error" in n && n.error.includes("gone.png"));
});

test("parseRun: pending, done, error with an out-of-memory hint", () => {
  assert.deepEqual(parseRun({}, "a"), { state: "pending" });
  assert.deepEqual(parseRun({ a: { status: { status_str: "success", completed: false } } }, "a"), { state: "pending" });
  assert.deepEqual(parseRun({ a: { status: { status_str: "success", completed: true } } }, "a"), { state: "done" });
  const r = parseRun({ a: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "a");
  assert.ok(r.state === "error" && r.error.includes("ran out of memory"));
});

test("isGlb: binary glTF header only", () => {
  assert.equal(isGlb(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 0])), true);
  assert.equal(isGlb(new TextEncoder().encode("<html>error</html>")), false);
});

test("robloxMaterials: non-metal, fully rough, colour texture kept, valid 4-byte-aligned glb", () => {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: 1 } } }] }));
  const jl = json.length + ((4 - (json.length % 4)) % 4);
  const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const glb = new Uint8Array(12 + 8 + jl + 8 + bin.length);
  const dv = new DataView(glb.buffer);
  glb.set([0x67, 0x6c, 0x54, 0x46]); dv.setUint32(4, 2, true); dv.setUint32(8, glb.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); glb.fill(0x20, 20, 20 + jl); glb.set(json, 20);
  dv.setUint32(20 + jl, bin.length, true); dv.setUint32(24 + jl, 0x004e4942, true); glb.set(bin, 28 + jl);
  const out = robloxMaterials(glb);
  const p = glbMaterials(out)[0].pbrMetallicRoughness!;
  assert.deepEqual([p.metallicFactor, p.roughnessFactor, p.metallicRoughnessTexture, p.baseColorTexture], [0, 1, undefined, { index: 0 }]);
  const odv = new DataView(out.buffer);
  assert.equal(odv.getUint32(8, true), out.length);
  assert.equal(odv.getUint32(12, true) % 4, 0);
  const jl2 = odv.getUint32(12, true);
  assert.equal(odv.getUint32(24 + jl2, true), 0x004e4942); // BIN chunk follows intact
  assert.deepEqual([...out.subarray(28 + jl2)], [...bin]);
  assert.equal(robloxMaterials(new Uint8Array([1, 2, 3])).length, 3); // not a glb: unchanged
});
