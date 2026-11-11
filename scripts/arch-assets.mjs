// Downloads ARCH's free render library (CC0, Poly Haven: furniture, plants, trees, textures, a dusk sky) into a local folder, so
// Blender renders show real furniture instead of grey boxes. Polite: one file at a time, skips what is already there.
//   node scripts/arch-assets.mjs <folder>        (about 400 MB at 1k textures)
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
const { libraryIds, LIBRARY_TEXTURES, LIBRARY_SKY } = await import("../src/lib/arch-blender-pure.ts");
const out = path.resolve(process.argv[2] ?? "arch-assets"), UA = { headers: { "User-Agent": "orbit-arch-assets/1.0" } };
const json = async (u) => (await fetch(u, UA)).json();
async function save(u, p) { if (existsSync(p)) return; mkdirSync(path.dirname(p), { recursive: true }); const r = await fetch(u, UA); if (!r.ok) throw new Error(`${r.status} ${u}`); writeFileSync(p, Buffer.from(await r.arrayBuffer())); }
for (const id of libraryIds()) {
  const g = (await json(`https://api.polyhaven.com/files/${id}`)).gltf["1k"].gltf;
  await save(g.url, path.join(out, id, path.basename(g.url)));
  for (const [rel, f] of Object.entries(g.include ?? {})) await save(f.url, path.join(out, id, rel));
  console.log("model", id);
}
for (const t of LIBRARY_TEXTURES) { const d = await json(`https://api.polyhaven.com/files/${t}`); for (const k of ["Diffuse", "Rough", "nor_gl"]) if (d[k]) await save(d[k]["1k"].jpg.url, path.join(out, `${t}_${k}.jpg`)); console.log("texture", t); }
await save((await json(`https://api.polyhaven.com/files/${LIBRARY_SKY}`)).hdri["2k"].hdr.url, path.join(out, "sky.hdr"));
writeFileSync(path.join(out, "CREDITS.md"), `Models, textures and sky: Poly Haven (https://polyhaven.com), CC0.\n`);
console.log("done:", out);
