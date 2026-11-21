import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAFT, DRAFT_FILES, FILES, ROBLOX, TARGET_FACES, draftWorkflow, glbMaterials, graphFor, isGlb, robloxMaterials, jobPrefix, outputRef, parseQueued, parseRun, qualityOf, trellisNotRunning, trellisUrl, workflow } from "../src/lib/trellis-pure.ts";

test("workflow: native ComfyUI nodes only, background cut, mesh capped to Roblox limits, glb export under orbit3d/", () => {
  const w = workflow({ image: "pet.png", seed: 42, job: "j123" });
  const by = (t: string) => Object.entries(w).filter(([, n]) => n.class_type === t);
  const one = (t: string) => { const m = by(t); assert.equal(m.length, 1, t); return m[0]; };
  // no custom node pack: every class is a ComfyUI core node (the old GGUF pack's classes ended in _GGUF)
  for (const n of Object.values(w)) assert.ok(!/_GGUF$|Rasteriz/i.test(n.class_type), n.class_type);
  assert.equal(one("LoadImage")[1].inputs.image, "pet.png");
  const [bgId] = one("RemoveBackground");
  assert.deepEqual(one("ImageCropToMask")[1].inputs.masks, [bgId, 0]);
  assert.equal(one("LoadBackgroundRemovalModel")[1].inputs.bg_removal_name, FILES.bgModel);
  assert.equal(one("UNETLoader")[1].inputs.unet_name, FILES.unet);
  assert.equal(by("KSampler").length, 4);
  for (const [, k] of by("KSampler")) assert.equal(k.inputs.seed, 42);
  const [decId, dec] = one("DecimateMesh");
  assert.equal(dec.inputs.target_face_count, TARGET_FACES);
  assert.ok(TARGET_FACES <= ROBLOX.maxFaces * 0.95);
  const [unwrapId, unwrap] = one("UnwrapMesh");
  assert.deepEqual(unwrap.inputs.mesh, [decId, 0]); // unwrap the decimated mesh, so the cap holds
  const [bakeId, bake] = one("BakeTextureFromVoxel");
  assert.deepEqual([bake.inputs.mesh, bake.inputs.texture_size], [[unwrapId, 0], ROBLOX.texture]);
  assert.deepEqual(one("ApplyTextureToMesh")[1].inputs.base_color, [bakeId, 0]);
  assert.equal(one("SaveGLB")[1].inputs.filename_prefix, "orbit3d/j123");
  // every link points at a node in the graph
  for (const n of Object.values(w)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(w[String(v[0])], `missing node ${v[0]}`);
});

test("job prefix and output: plain characters only; ComfyUI's first counter file", () => {
  assert.equal(jobPrefix("../../x y"), "orbit3d/xy");
  assert.equal(jobPrefix("!!"), "orbit3d/job");
  assert.deepEqual(outputRef("j1"), { filename: "j1_00001_.glb", subfolder: "orbit3d", type: "output" });
});

test("quality: explicit best → TRELLIS.2, draft/quick/blocking → Pixal3D, the rest → TripoSR", () => {
  assert.equal(qualityOf("best"), "best");
  assert.equal(qualityOf(" BEST "), "best");
  for (const q of ["draft", " Draft ", "quick", "blocking", "blockout"]) assert.equal(qualityOf(q), "draft");
  for (const q of [undefined, "", "fast", "high", "drafty", 1]) assert.equal(qualityOf(q), "fast");
});

test("draft workflow: Pixal3D shape 512 only, no texture, capped for Roblox, same output path", () => {
  const w = draftWorkflow({ image: "pet.png", seed: 7, job: "j9" });
  const by = (t: string) => Object.entries(w).filter(([, n]) => n.class_type === t);
  const one = (t: string) => { const m = by(t); assert.equal(m.length, 1, t); return m[0]; };
  for (const n of Object.values(w)) assert.ok(!/_GGUF$|Rasteriz/i.test(n.class_type), n.class_type);
  assert.equal(one("UNETLoader")[1].inputs.unet_name, DRAFT_FILES.unet);
  assert.equal(one("CLIPVisionLoader")[1].inputs.clip_name, DRAFT_FILES.dino);
  assert.equal(one("LoadMoGeModel")[1].inputs.model_name, DRAFT_FILES.moge);
  assert.equal(DRAFT_FILES.shapeVae, FILES.shapeVae); // byte-identical file, downloaded once
  const [cropId, crop] = one("ImageCropToMask");
  assert.equal(crop.inputs.pad_factor, 1.1);
  const [fovId] = one("MoGeGeometryToFOV");
  const [condId, cond] = one("Pixal3DConditioning");
  assert.deepEqual([cond.inputs.image, cond.inputs.camera_angle_x], [[cropId, 0], [fovId, 0]]);
  assert.equal(by("Trellis2Conditioning").length, 0);
  // the fast path: one structure pass + one shape pass at 512; no upsample, texture or bake
  for (const t of ["Trellis2UpsampleStage", "Trellis2TextureStage", "VaeDecodeTextureTrellis", "UnwrapMesh", "BakeTextureFromVoxel", "ApplyTextureToMesh"]) assert.equal(by(t).length, 0, t);
  const ks = by("KSampler");
  assert.deepEqual(ks.map(([, k]) => k.inputs.steps).sort(), [DRAFT.shapeSteps, DRAFT.structureSteps].sort());
  for (const [, k] of ks) assert.equal(k.inputs.seed, 7);
  assert.equal(one("VaeDecodeStructureTrellis2")[1].inputs.resolution, "32"); // → Trellis2ShapeStage picks shape_512
  assert.deepEqual(one("Trellis2ShapeStage")[1].inputs.positive, [condId, 0]);
  const [, dec] = one("DecimateMesh");
  assert.ok(Number(dec.inputs.target_face_count) <= TARGET_FACES && TARGET_FACES < ROBLOX.maxFaces);
  assert.equal(one("SaveGLB")[1].inputs.filename_prefix, "orbit3d/j9");
  for (const n of Object.values(w)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(w[String(v[0])], `missing node ${v[0]}`);
  assert.deepEqual(graphFor("draft", { image: "a.png", seed: 1, job: "x" }), draftWorkflow({ image: "a.png", seed: 1, job: "x" }));
  assert.deepEqual(graphFor("best", { image: "a.png", seed: 1, job: "x" }), workflow({ image: "a.png", seed: 1, job: "x" }));
});

test("draft errors point at setup.ps1 -Draft", () => {
  const e = parseQueued({ prompt_id: "x", node_errors: { "10": { errors: [{ message: "Value not in list", details: "unet_name: 'pixal3d_int8_convrot.safetensors' not in []" }] } } }, "draft");
  assert.ok("error" in e && e.error.includes("setup.ps1 -Draft") && e.error.startsWith("Pixal3D"));
  const r = parseRun({ a: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "a", "draft");
  assert.ok(r.state === "error" && r.error.startsWith("Pixal3D (draft) failed") && r.error.includes("ran out of memory"));
  assert.ok(trellisNotRunning("draft").includes("setup.ps1 -Draft"));
  assert.ok(!trellisNotRunning().includes("-Draft"));
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
