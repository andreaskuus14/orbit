# ORBIT best-quality picture → 3D (TRELLIS.2)

CORE's `local_3d` with `"quality": "best"` turns one VAULT picture into a textured `.glb` sized for Roblox. `"fast"` (the default)
still uses TripoSR from `tools/local-ai`.

**Status (2026-11-20): switched to ComfyUI's native TRELLIS.2 nodes so the output can be used commercially. Not yet run on the
RTX 5060 Laptop.** The graph was checked against a real ComfyUI v0.46.0 (CPU, placeholder model files): it passes ComfyUI's
own validation with no node errors. Still to check on the GPU: VRAM/RAM fit, time per model, texture quality, triangle count
(`node --experimental-strip-types tools\trellis\smoke.ts`), then Roblox Studio → Import 3D.

The previous setup (Aero-Ex/ComfyUI-Trellis2-GGUF) worked (19,356 triangles, 445 s on 2026-11-19), but it installed
`nvdiffrast` and `nvdiffrec_render`, which are under NVIDIA's Source Code License (non-commercial research/evaluation only).
Running `setup.ps1` again removes them. **Models made with the old setup should be made again before they go into a game that
earns money.**

| | |
|---|---|
| Model | [Microsoft TRELLIS.2-4B](https://github.com/microsoft/TRELLIS.2), int8 weights repackaged by [Comfy-Org](https://huggingface.co/Comfy-Org/TRELLIS.2) |
| Nodes | ComfyUI core (no custom node pack): `Trellis2Conditioning`, `Trellis2ShapeStage`, `Trellis2UpsampleStage`, `Trellis2TextureStage`, `RemeshMesh`, `DecimateMesh`, `UnwrapMesh`, `BakeTextureFromVoxel`, `SaveGLB`. Post-processing and texture baking are pure PyTorch/SciPy: no nvdiffrast, cumesh, flex_gemm, o_voxel or xatlas |
| Graph | `src/lib/trellis-pure.ts`, following ComfyUI's template `3d_pixal3d_trellis2_image_to_model` (TRELLIS.2 branch), with shape resolution 1024 (template 1536) and remesh 384 (template 768) for 8 GB |
| Output | `.glb`, background cut first (BiRefNet), max 19,000 triangles (Roblox limit 20,000) and a 1024 px colour texture; ORBIT then makes every material non-metal and fully rough |
| VRAM / speed | **unmeasured.** Diffusion model 5.3 GB int8, run with `--lowvram`; ComfyUI unloads it before the mesh steps |
| Where | separate ComfyUI on `127.0.0.1:8189`, own Python 3.12 + PyTorch 2.10 CUDA 13.0 in `tools/trellis/env` |

Not used on purpose: Hunyuan3D (its license excludes the EU) and RMBG-2.0 (non-commercial weights). Pixal3D (built on
TRELLIS.2, "generally better" alignment with the picture) is also native in this ComfyUI and its weights are MIT and no
longer gated (checked 2026-11-20), but it isn't wired in yet: it needs a 5.6 GB model plus MoGe (MIT) for the camera angle.

## Setup (once)

1. NVIDIA driver 580 or newer, and git (`winget install Git.Git`).
2. In the ORBIT folder: `powershell -ExecutionPolicy Bypass -File tools\trellis\setup.ps1` (downloads ~8.9 GB of model files,
   pinned and SHA-256 checked, and removes the old non-commercial parts).
3. Check: `node --experimental-strip-types tools\trellis\smoke.ts` prints PASS with the triangle count.
4. Ask CORE: "make a best-quality 3D model of <VAULT picture>", then Roblox Studio → Import 3D → the `.glb` from VAULT.

By hand: `tools\trellis\start.ps1`, then http://127.0.0.1:8189. Settings: `ORBIT_TRELLIS_URL`, `ORBIT_TRELLIS_AUTOSTART=0`.
ORBIT frees the GPU 30 s after a job so pictures and voice can use it. Old GGUF weights in `tools\trellis\ComfyUI\models` from
the previous setup can be deleted.

## Licenses

Everything `setup.ps1` installs, and whether the result may be used in a game that earns money. Checked 2026-11-20 (license
files, Hugging Face model cards and PyPI metadata). Not legal advice.

**Models (these shape the output)**

| Component | License | Commercial use |
|---|---|---|
| [TRELLIS.2-4B](https://huggingface.co/microsoft/TRELLIS.2-4B) (code: [github](https://github.com/microsoft/TRELLIS.2)) | MIT | yes |
| [Comfy-Org/TRELLIS.2](https://huggingface.co/Comfy-Org/TRELLIS.2) repackaged weights (int8 model, shape/texture VAEs) | MIT | yes |
| DINOv3 ViT-L image encoder (`dino_v3_vit_l.safetensors`, same repo) | [Meta DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) | yes: worldwide, royalty-free. Not MIT/Apache: it forbids military, ITAR and sanctioned uses and asks redistributors to pass the license on. Every TRELLIS.2 and Pixal3D setup uses it |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) background cut ([Comfy-Org/BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet)) | MIT | yes |

**Software (runs the models; the meshes it writes are not covered by these licenses)**

| Component | License |
|---|---|
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) v0.46.0, including the native TRELLIS.2 and mesh nodes | GPL-3.0 |
| [comfy-aimdo](https://github.com/Comfy-Org/comfy-aimdo), comfyui-frontend-package, comfyui-embedded-docs (ComfyUI requirements) | GPL-3.0 |
| [comfy-kitchen](https://pypi.org/project/comfy-kitchen/) (int8 kernels) | Apache-2.0 |
| [comfy-angle](https://pypi.org/project/comfy-angle/), [PyOpenGL](https://github.com/mcfletch/pyopengl) | BSD-3-Clause / BSD |
| comfyui-workflow-templates | MIT |
| [PyTorch](https://github.com/pytorch/pytorch) 2.10 + torchvision | BSD-3-Clause (with bundled third-party notices) |
| NVIDIA CUDA 13.0 runtime libraries inside the PyTorch cu130 wheels | [NVIDIA CUDA EULA](https://docs.nvidia.com/cuda/eula/) (redistributable runtime; no non-commercial clause) |
| Other ComfyUI requirements: numpy, scipy, einops, transformers, tokenizers, sentencepiece, safetensors, aiohttp, yarl, pyyaml, Pillow, psutil, alembic, SQLAlchemy, filelock, requests, simpleeval, blake3, kornia, spandrel, pydantic, torchsde | MIT, BSD or Apache-2.0 |
| tqdm | MPL-2.0 AND MIT |
| [PyAV](https://github.com/PyAV-Org/PyAV) (`av`) | BSD-3-Clause; its wheels bundle FFmpeg (LGPL) |
| [uv](https://github.com/astral-sh/uv) 0.13.9 | MIT or Apache-2.0 |
| Python 3.12 | PSF License |

GPL-3.0 (ComfyUI) is copyleft for the program if you share the program; it puts no limit on commercial use or on the files it
outputs. It is the only non-MIT/Apache/BSD software here, and the old setup had it too.

**Removed (non-commercial or no longer needed)**: `nvdiffrast` and `nvdiffrec_render` (NVIDIA Source Code License,
non-commercial), `cumesh`, `flex_gemm`, `o_voxel` (PozzettiAndrea/cuda-wheels builds), the Aero-Ex/ComfyUI-Trellis2-GGUF and
city96/ComfyUI-GGUF node packs (rembg and onnxruntime, MIT, stay in the env but are no longer used). The setup's last step fails if nvdiffrast, nvdiffrec or kaolin can still be imported.
