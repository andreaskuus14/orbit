// Real modelled assets for the planet worlds (v5): CC0 models and HDRIs from Poly Haven, compressed (glTF + meshopt,
// 512 px webp textures) under public/worlds/. Each world loads only its own files, and only on tier > 0; tier 0 (low
// preset) keeps the procedural look. Sources and licences: public/worlds/LICENSES.md.

export type WorldId = "gamedev" | "memory" | "arch" | "life" | "vault" | "studio" | "agents";
export type AssetId = "fort" | "tree" | "rocks" | "cliff" | "shrub" | "fern" | "flower" | "moonRock"
  | "plateVaultBack" | "plateVaultSide" | "lantern" | "chest" | "hdriNight" | "hdriDay"
  | "grassD" | "grassN" | "cliffD" | "cliffN" | "mtnD" | "mtnN" | "mtnH" | "waterN"
  | "woodD" | "woodN" | "woodR" | "roofD" | "roofN" | "roofR" | "stuccoD" | "stuccoN" | "stuccoR";

export type Asset = { file: string; source: string; worlds: WorldId[] };

export const ASSETS: Record<AssetId, Asset> = {
  fort: { file: "models/modular_fort_01.glb", source: "https://polyhaven.com/a/modular_fort_01", worlds: ["gamedev"] },
  tree: { file: "models/island_tree_01.glb", source: "https://polyhaven.com/a/island_tree_01", worlds: ["gamedev", "life", "arch"] },
  rocks: { file: "models/rock_moss_set_01.glb", source: "https://polyhaven.com/a/rock_moss_set_01", worlds: ["gamedev", "life", "arch"] },
  cliff: { file: "models/coastal_cliff_02.glb", source: "https://polyhaven.com/a/coastal_cliff_02", worlds: ["arch"] },
  shrub: { file: "models/shrub_01.glb", source: "https://polyhaven.com/a/shrub_01", worlds: ["life", "gamedev", "arch"] },
  fern: { file: "models/fern_02.glb", source: "https://polyhaven.com/a/fern_02", worlds: ["life", "arch"] },
  flower: { file: "models/celandine_01.glb", source: "https://polyhaven.com/a/celandine_01", worlds: ["life", "arch"] },
  moonRock: { file: "models/moon_rock_03.glb", source: "https://polyhaven.com/a/moon_rock_03", worlds: ["memory"] },
  // v9 matte plates: cleaned crops of the owner's own Higgsfield frames (no baked text/UI), used as far backdrops behind the live 3D.
  plateVaultBack: { file: "plates/vault-back.webp", source: "owner's Higgsfield renders (vault frame, dome and door wall)", worlds: ["vault"] },
  plateVaultSide: { file: "plates/vault-balcony.webp", source: "owner's Higgsfield renders (vault zoom frame, arched balconies)", worlds: ["vault"] },
  lantern: { file: "models/Lantern_01.glb", source: "https://polyhaven.com/a/Lantern_01", worlds: ["vault"] },
  chest: { file: "models/metal_tool_chest.glb", source: "https://polyhaven.com/a/metal_tool_chest", worlds: ["vault"] },
  hdriNight: { file: "hdri/moonless_golf.hdr", source: "https://polyhaven.com/a/moonless_golf", worlds: ["memory"] },
  hdriDay: { file: "hdri/kloofendal_48d_partly_cloudy_puresky.hdr", source: "https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky", worlds: ["arch"] },
  // v6 textures (512 px webp): ground and cliff rock for the islands, mountain rock + its height for ARCH, water ripples.
  grassD: { file: "textures/leafy_grass_diff.webp", source: "https://polyhaven.com/a/leafy_grass", worlds: ["gamedev", "arch"] },
  grassN: { file: "textures/leafy_grass_nor.webp", source: "https://polyhaven.com/a/leafy_grass", worlds: ["gamedev", "arch"] },
  cliffD: { file: "textures/rock_face_03_diff.webp", source: "https://polyhaven.com/a/rock_face_03", worlds: ["gamedev", "arch"] },
  cliffN: { file: "textures/rock_face_03_nor.webp", source: "https://polyhaven.com/a/rock_face_03", worlds: ["gamedev", "arch"] },
  mtnD: { file: "textures/aerial_rocks_02_diff.webp", source: "https://polyhaven.com/a/aerial_rocks_02", worlds: ["arch"] },
  mtnN: { file: "textures/aerial_rocks_02_nor.webp", source: "https://polyhaven.com/a/aerial_rocks_02", worlds: ["arch"] },
  mtnH: { file: "textures/aerial_rocks_02_height.webp", source: "https://polyhaven.com/a/aerial_rocks_02", worlds: ["arch"] },
  waterN: { file: "textures/waternormals.webp", source: "https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg", worlds: ["gamedev", "life", "arch"] },
  // v7 (ARCH house skin): cedar cladding, dark ribbed metal roof, stucco. Diffuse 512 px, normal (OpenGL) 512 px, roughness 256 px grey.
  woodD: { file: "textures/cedar_planks_diff.webp", source: "https://polyhaven.com/a/japanese_cedar_planks", worlds: ["arch"] },
  woodN: { file: "textures/cedar_planks_nor.webp", source: "https://polyhaven.com/a/japanese_cedar_planks", worlds: ["arch"] },
  woodR: { file: "textures/cedar_planks_rough.webp", source: "https://polyhaven.com/a/japanese_cedar_planks", worlds: ["arch"] },
  roofD: { file: "textures/corrugated_iron_02_diff.webp", source: "https://polyhaven.com/a/corrugated_iron_02", worlds: ["arch"] },
  roofN: { file: "textures/corrugated_iron_02_nor.webp", source: "https://polyhaven.com/a/corrugated_iron_02", worlds: ["arch"] },
  roofR: { file: "textures/corrugated_iron_02_rough.webp", source: "https://polyhaven.com/a/corrugated_iron_02", worlds: ["arch"] },
  stuccoD: { file: "textures/white_stucco_diff.webp", source: "https://polyhaven.com/a/white_stucco", worlds: ["arch"] },
  stuccoN: { file: "textures/white_stucco_nor.webp", source: "https://polyhaven.com/a/white_stucco", worlds: ["arch"] },
  stuccoR: { file: "textures/white_stucco_rough.webp", source: "https://polyhaven.com/a/white_stucco", worlds: ["arch"] },
};

/** Whole folder may not pass this (bytes); one world's own files may not pass PER_WORLD. */
/** v9: raised from 15 MB to 25 MB (owner, for his own Higgsfield renders used as matte plates). */
export const BUDGET = 25 * 1024 * 1024, PER_WORLD = 6 * 1024 * 1024;

export const assetUrl = (id: AssetId) => `/worlds/${ASSETS[id].file}`;
/** Real assets only on tier 1+ (medium/high). Low keeps the procedural parts and downloads nothing. */
export const useRealAssets = (tier: number) => tier > 0;
export const assetsFor = (w: WorldId) => (Object.keys(ASSETS) as AssetId[]).filter((k) => ASSETS[k].worlds.includes(w));

export type V3 = [number, number, number];
/** Scale that fits a model of `size` into `target` (w, h, d). uniform: keep proportions, matched to the height. */
export function fitScale(size: V3, target: V3, uniform: boolean): V3 {
  const s = (t: number, v: number) => (v > 1e-6 ? t / v : 1);
  if (uniform) { const k = s(target[1], size[1]); return [k, k, k]; }
  return [s(target[0], size[0]), s(target[1], size[1]), s(target[2], size[2])];
}

/** Which fort piece stands in for a game part: towers are round towers, walls thin walls, halls the thick corner block. */
export function fortPiece(kind: string): string {
  if (kind === "tower") return "modular_fort_01_tower_round";
  if (kind === "wall") return "modular_fort_01_wall_thin_straight_01";
  return "modular_fort_01_wall_thick_corner_01";
}
