# World assets: licences

The `plates/` files are the owner's own Higgsfield renders (cropped matte-painting backdrops, no baked text), used with his approval; the folder budget is 25 MB (raised from 15 MB for them). All other files here except `textures/waternormals.webp` are **CC0 1.0 (public domain)** from [Poly Haven](https://polyhaven.com/license): free for any use, commercial included, no credit required.
Models were re-encoded (glTF binary, meshopt geometry, 512 px webp textures, simplified meshes); HDRIs are the 1k versions.

| File | Source | Licence |
| --- | --- | --- |
| models/modular_fort_01.glb | https://polyhaven.com/a/modular_fort_01 | CC0 1.0 |
| models/island_tree_01.glb | https://polyhaven.com/a/island_tree_01 | CC0 1.0 |
| models/rock_moss_set_01.glb | https://polyhaven.com/a/rock_moss_set_01 | CC0 1.0 |
| models/coastal_cliff_02.glb | https://polyhaven.com/a/coastal_cliff_02 | CC0 1.0 |
| models/shrub_01.glb | https://polyhaven.com/a/shrub_01 | CC0 1.0 |
| models/fern_02.glb | https://polyhaven.com/a/fern_02 | CC0 1.0 |
| models/celandine_01.glb | https://polyhaven.com/a/celandine_01 | CC0 1.0 |
| models/moon_rock_03.glb | https://polyhaven.com/a/moon_rock_03 | CC0 1.0 |
| models/Lantern_01.glb | https://polyhaven.com/a/Lantern_01 | CC0 1.0 |
| models/metal_tool_chest.glb | https://polyhaven.com/a/metal_tool_chest | CC0 1.0 |
| hdri/moonless_golf.hdr | https://polyhaven.com/a/moonless_golf | CC0 1.0 |
| hdri/kloofendal_48d_partly_cloudy_puresky.hdr | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 1.0 |
| textures/leafy_grass_diff.webp, textures/leafy_grass_nor.webp | https://polyhaven.com/a/leafy_grass | CC0 1.0 |
| textures/rock_face_03_diff.webp, textures/rock_face_03_nor.webp | https://polyhaven.com/a/rock_face_03 | CC0 1.0 |
| textures/aerial_rocks_02_diff.webp, textures/aerial_rocks_02_nor.webp, textures/aerial_rocks_02_height.webp | https://polyhaven.com/a/aerial_rocks_02 | CC0 1.0 |
| textures/cedar_planks_diff.webp, textures/cedar_planks_nor.webp, textures/cedar_planks_rough.webp | https://polyhaven.com/a/japanese_cedar_planks | CC0 1.0 |
| textures/corrugated_iron_02_diff.webp, textures/corrugated_iron_02_nor.webp, textures/corrugated_iron_02_rough.webp | https://polyhaven.com/a/corrugated_iron_02 | CC0 1.0 |
| textures/white_stucco_diff.webp, textures/white_stucco_nor.webp, textures/white_stucco_rough.webp | https://polyhaven.com/a/white_stucco | CC0 1.0 |
| plates/vault-back.webp | owner's Higgsfield renders (vault frame, dome and door wall) | Owner's own renders: cropped, text/UI-free, 2x upscaled, webp |
| plates/vault-balcony.webp | owner's Higgsfield renders (vault zoom frame, arched balconies) | Owner's own renders: cropped, text/UI-free, 2x upscaled, webp |
| textures/waternormals.webp | https://github.com/mrdoob/three.js/blob/dev/examples/textures/waternormals.jpg | MIT (three.js, https://github.com/mrdoob/three.js/blob/dev/LICENSE): commercial use fine, keep the notice |

Textures are the 1k Poly Haven maps (diffuse, OpenGL normal, displacement as height) re-encoded to 512 px webp (height 256 px grey).

## v10 frame scenes (public/worlds/frames/)

| File | Source | Licence |
|---|---|---|
| frames/<id>.webp, frames/zoom-<id>.webp | owner's Higgsfield renders (text-free plates, or crops with baked text inpainted by scripts/frame-scenes/build.py), 2048 px wide webp | Owner's own renders |
| frames/<id>-depth.webp, frames/zoom-<id>-depth.webp | Depth Anything V2 Small run offline (https://huggingface.co/depth-anything/Depth-Anything-V2-Small) on those renders, 512 px grey webp | Apache-2.0 (model); the depth maps are derived from the owner's own renders |

Frame budget: the whole public/worlds folder stays under 60 MB (FRAME_BUDGET_BYTES in src/lib/frame-scene-pure.ts, checked by tests/frame-scene.test.ts). The 25 MB cap above still covers the registered real assets (ASSETS).
