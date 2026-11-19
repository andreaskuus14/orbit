// Smoke test for the TRELLIS.2 service, without ORBIT running: picture → .glb through the exact graph ORBIT sends.
//   node --experimental-strip-types tools/trellis/smoke.ts [picture.png]
// Needs tools\trellis\start.ps1 running (or ORBIT's autostart); waits up to 5 min for it to come up. Writes tools/trellis/smoke-output.glb and prints
// time, size and triangle count (must be <= 20,000 for Roblox).
import { readFileSync, writeFileSync } from "node:fs";
import { ROBLOX, glbMaterials, isGlb, outputRef, parseQueued, parseRun, robloxMaterials, workflow } from "../../src/lib/trellis-pure.ts";

const u = "http://127.0.0.1:8189";
const pic = process.argv[2] ?? new URL("./smoke-test.png", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const t0 = Date.now();
const sec = () => `${Math.round((Date.now() - t0) / 1000)} s`;

/** Triangles in a binary glTF: index count / 3 per triangle primitive (or vertex count / 3 without indices). */
function triangles(b: Uint8Array): number {
  const len = new DataView(b.buffer, b.byteOffset).getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len))) as { meshes?: { primitives: { indices?: number; mode?: number; attributes: { POSITION: number } }[] }[]; accessors: { count: number }[] };
  let n = 0;
  for (const m of j.meshes ?? []) for (const p of m.primitives) if ((p.mode ?? 4) === 4) n += j.accessors[p.indices ?? p.attributes.POSITION].count / 3;
  return Math.round(n);
}

// wait for the server (first start imports torch and checks the node pack: can take a few minutes)
for (let i = 0; ; i++) {
  if (await fetch(`${u}/system_stats`).then((r) => r.ok, () => false)) break;
  if (i >= 60) { console.error(`FAIL: TRELLIS.2 isn't running on ${u} after 5 min. Start tools\\trellis\\start.ps1 and check its window.`); process.exit(1); }
  if (i === 0) console.log("waiting for the TRELLIS.2 server...");
  await new Promise((r) => setTimeout(r, 5000));
}
const up = new FormData();
up.append("image", new Blob([readFileSync(pic)], { type: "image/png" }), "orbit-smoke.png");
up.append("overwrite", "true");
const ur = await fetch(`${u}/upload/image`, { method: "POST", body: up }).catch(() => null);
if (!ur?.ok) { console.error(`FAIL: TRELLIS.2 isn't running on ${u}. Start tools\\trellis\\start.ps1 first.`); process.exit(1); }
const name = ((await ur.json()) as { name: string }).name;
const job = `smoke${Date.now().toString(36)}`;
const q = parseQueued(await (await fetch(`${u}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow({ image: name, seed: 42, job }), client_id: "orbit-smoke" }) })).json());
if ("error" in q) { console.error(`FAIL (queue): ${q.error}`); process.exit(1); }
console.log(`queued ${q.id}; the first run downloads ~10 GB of model files...`);
const limit = 45 * 60_000; // first run downloads ~9 GB; a normal job is a few minutes
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  if (Date.now() - t0 > limit) { await fetch(`${u}/interrupt`, { method: "POST" }).catch(() => {}); console.error(`FAIL: no result after ${sec()}. Check the TRELLIS.2 window for the error.`); process.exit(1); }
  const res = await fetch(`${u}/history/${q.id}`).catch(() => null);
  if (!res) { console.error(`FAIL after ${sec()}: the TRELLIS.2 server stopped. Check its window for the error.`); process.exit(1); }
  const h = parseRun(await res.json(), q.id);
  if (h.state === "error") { console.error(`FAIL after ${sec()}: ${h.error}`); process.exit(1); }
  if (h.state === "done") break;
  if ((Date.now() - t0) % 60_000 < 5000) console.log(`still working (${sec()})`);
}
const r = await fetch(`${u}/view?${new URLSearchParams(outputRef(job))}`);
const raw = new Uint8Array(await r.arrayBuffer());
if (!r.ok || !isGlb(raw)) { console.error(`FAIL: finished but no .glb came back (${r.status}).`); process.exit(1); }
const glb = robloxMaterials(raw); // same step ORBIT applies
const mat = glbMaterials(glb)[0]?.pbrMetallicRoughness ?? {};
console.log(`material: metallic ${mat.metallicFactor}, roughness ${mat.roughnessFactor}`);
const out = new URL("./smoke-output.glb", import.meta.url);
writeFileSync(out, glb);
const tris = triangles(glb);
console.log(`${tris <= ROBLOX.maxFaces ? "PASS" : "FAIL"}: ${sec()}, ${(glb.length / 1e6).toFixed(1)} MB, ${tris} triangles (Roblox max ${ROBLOX.maxFaces}). Saved ${out.pathname}`);
console.log("Last check is yours: Roblox Studio → Import 3D → tools\\trellis\\smoke-output.glb");
