import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EDIT_FILES, EDIT_STEPS, checkEdit, editSeed, editWorkflow, editNotInstalled, missingEditFiles, parseEditHistory, parseEditQueued } from "../src/lib/image-edit-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";
import { coreToolRefusal } from "../src/lib/stop-all-pure.ts";
import { EFFECTS } from "../src/lib/approval-pure.ts";
import { SCHEMAS } from "../src/lib/mcp-schemas-pure.ts";

type G = ReturnType<typeof editWorkflow>;
const refs = (g: G) => Object.entries(g).flatMap(([id, n]) => Object.values(n.inputs).filter(Array.isArray).map((r) => [id, (r as [string, number])[0]]));

test("editWorkflow: klein edit graph, one reference picture on positive and zeroed negative, 4 steps cfg 1", () => {
  const g = editWorkflow({ instruction: "make the sky a sunset", image: "up.png", seed: 5 });
  assert.deepEqual(g["70"].inputs, { unet_name: EDIT_FILES.unet, weight_dtype: "default" });
  assert.deepEqual(g["71"].inputs, { clip_name: EDIT_FILES.clip, type: "flux2", device: "default" });
  assert.equal(g["81"].inputs.image, "up.png");
  assert.equal(g["74"].inputs.text, "make the sky a sunset");
  assert.equal(g["62"].inputs.steps, EDIT_STEPS);
  assert.equal(g["73"].inputs.noise_seed, 5);
  assert.deepEqual([g["63"].inputs.cfg, g["63"].inputs.positive, g["63"].inputs.negative], [1, ["123", 0], ["121", 0]]);
  assert.deepEqual(g["121"].inputs.conditioning, ["82", 0]); // negative = zeroed prompt + the same reference
  assert.deepEqual(g["123"].inputs.latent, g["121"].inputs.latent);
  assert.deepEqual(g["66"].inputs.width, ["99", 0]); // latent and scheduler follow the scaled picture's size
  assert.equal(g["80"].inputs.resolution_steps, 16);
  assert.equal(g["9"].class_type, "SaveImage");
});

test("editWorkflow: every link points at a node that exists; text-to-picture models are untouched", () => {
  const g = editWorkflow({ instruction: "x y z", image: "a.png", seed: 1 });
  for (const [id, to] of refs(g)) assert.ok(g[to], `${id} -> ${to}`);
  assert.ok(!Object.values(g).some((n) => n.class_type === "CheckpointLoaderSimple"));
});

test("checkEdit: needs a VAULT picture and an instruction; clamps whitespace and length", () => {
  assert.deepEqual(checkEdit({ image: " fox.PNG ", instruction: "  make it   blue ", name: "blue fox" }), { image: "fox.PNG", instruction: "make it blue", name: "blue fox" });
  assert.deepEqual(checkEdit({ image: "a.webp", instruction: "abc" }), { image: "a.webp", instruction: "abc", name: "" });
  for (const bad of [{}, { image: "a.png" }, { image: "a.png", instruction: "no" }, { image: "notes.txt", instruction: "make it blue" }, { instruction: "make it blue" }, { image: "a.png", instruction: "x".repeat(601) }])
    assert.ok("error" in checkEdit(bad), JSON.stringify(bad));
  assert.equal(editSeed({ image: "a.png", instruction: "b", name: "" }), editSeed({ image: "a.png", instruction: "b", name: "other" }));
  assert.notEqual(editSeed({ image: "a.png", instruction: "b", name: "" }), editSeed({ image: "a.png", instruction: "c", name: "" }));
});

test("missingEditFiles reads ComfyUI's /object_info lists", () => {
  const loader = (node: string, field: string, names: string[]) => ({ [node]: { input: { required: { [field]: [names] } } } });
  const ok = { unet: loader("UNETLoader", "unet_name", [EDIT_FILES.unet]), clip: loader("CLIPLoader", "clip_name", [EDIT_FILES.clip, "x"]), vae: loader("VAELoader", "vae_name", [EDIT_FILES.vae]) };
  assert.deepEqual(missingEditFiles(ok), []);
  assert.deepEqual(missingEditFiles({ ...ok, clip: loader("CLIPLoader", "clip_name", ["other.safetensors"]) }), [EDIT_FILES.clip]);
  assert.deepEqual(missingEditFiles({}), [EDIT_FILES.unet, EDIT_FILES.clip, EDIT_FILES.vae]);
});

test("replies: queued id, missing files/nodes → the setup hint, other errors pass through, history reuses the picture parser", () => {
  assert.deepEqual(parseEditQueued({ prompt_id: "p1", node_errors: {} }), { id: "p1" });
  assert.match((parseEditQueued({ error: { type: "invalid_prompt", message: "Cannot execute because node Flux2Scheduler does not exist." } }) as { error: string }).error, /setup\.ps1 -Model flux2-klein-edit/);
  assert.match((parseEditQueued({ node_errors: { 70: { errors: [{ message: "Value not in list", details: "unet_name: 'x' not in []" }] } } }) as { error: string }).error, new RegExp(editNotInstalled().slice(0, 30)));
  assert.equal((parseEditQueued({ error: "boom" }) as { error: string }).error, "boom");
  assert.equal(parseEditHistory({}, "p1").state, "pending");
  assert.deepEqual(parseEditHistory({ p1: { status: { completed: true }, outputs: { 9: { images: [{ filename: "edit_00001_.png", subfolder: "orbit", type: "output" }] } } } }, "p1"),
    { state: "done", image: { filename: "edit_00001_.png", subfolder: "orbit", type: "output" } });
  assert.match((parseEditHistory({ p1: { status: { status_str: "error", messages: [["execution_error", { exception_message: "CUDA out of memory" }]] } } }, "p1") as { error: string }).error, /ran out of memory/);
});

test("local_image_edit: free local write like local_image (no approval), Stop-all refuses it, reversible, MCP schema requires image + instruction", () => {
  const ctx = { question: "edit my picture", steps: [], attach: false, pins: false, stopAll: false };
  assert.equal(decide("local_image_edit", { image: "a.png", instruction: "make it blue" }, ctx).allow, true);
  assert.equal(decide("local_image_edit", { image: "a.png", instruction: "make it blue" }, { ...ctx, stopAll: true }).allow, false);
  assert.match(coreToolRefusal(true, "local_image_edit"), /paused/);
  assert.equal(EFFECTS.local_image_edit, "reversible");
  assert.deepEqual(SCHEMAS.local_image_edit.required, ["image", "instruction"]);
});

test("setup.ps1: the flux2-klein-edit block pins every file (URL revision, sha256, bytes) and matches EDIT_FILES", () => {
  const ps = readFileSync(new URL("../tools/comfyui/setup.ps1", import.meta.url), "utf8");
  const block = ps.slice(ps.indexOf("BEGIN flux2-klein-edit"), ps.indexOf("END flux2-klein-edit"));
  assert.match(ps, /ValidateSet\([^)]*"flux2-klein-edit"/);
  const installs = [...block.matchAll(/InstallModel "[^"]+\\([^"\\]+)" "[^"]+" "([0-9a-f]{64})" (\d+)/g)];
  assert.deepEqual(installs.map((m) => m[1]).sort(), Object.values(EDIT_FILES).sort());
  assert.ok(installs.every((m) => Number(m[3]) > 1e8));
  assert.match(block, /resolve\/[0-9a-f]{40}"/);
});
