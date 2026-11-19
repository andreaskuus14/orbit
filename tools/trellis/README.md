# ORBIT best-quality picture → 3D (TRELLIS.2)

CORE's `local_3d` with `"quality": "best"` turns one VAULT picture into a textured `.glb` sized for Roblox. `"fast"` (the default)
still uses TripoSR from `tools/local-ai`.

**Status: untested on Windows and on a GPU.** Written in a cloud box. The graph and reply parsing are unit-tested
(`tests/trellis.test.ts`); the install and a real generation were never run.

| | |
|---|---|
| Model | [Microsoft TRELLIS.2-4B](https://github.com/microsoft/TRELLIS.2), GGUF Q5_K_M from Aero-Ex/Trellis2-GGUF, low-VRAM mode |
| Nodes | [Aero-Ex/ComfyUI-Trellis2-GGUF](https://github.com/Aero-Ex/ComfyUI-Trellis2-GGUF) (MIT), pinned |
| License | TRELLIS.2: MIT. Image encoder DINOv3: Meta's DINOv3 License (commercial use allowed; no military use) |
| Output | `.glb`, background removed first (rembg), max 20,000 triangles and a 1024 px texture (Roblox's import limits) |
| VRAM / speed | fits 8 GB in low-VRAM mode; about 2 min per model on an RTX 4060-class laptop GPU (community numbers) |
| Where | separate ComfyUI on `127.0.0.1:8189`, own Python 3.12 + PyTorch 2.10 CUDA 13.0 in `tools/trellis/env` |

Why a separate ComfyUI: TRELLIS.2's CUDA helpers (cumesh, nvdiffrast, flex_gemm, o_voxel) ship Windows wheels only for Python
3.11/3.12; `tools/comfyui` runs Python 3.13, and forcing them in would break local pictures.

Not used on purpose: Hunyuan3D (its license excludes the EU) and the Pixal3D model in the same node pack (EU-gated weights).

## Setup (once)

1. NVIDIA driver 580 or newer, and git (`winget install Git.Git`).
2. In the ORBIT folder: `powershell -ExecutionPolicy Bypass -File tools\trellis\setup.ps1`
3. Ask CORE: "make a best-quality 3D model of <VAULT picture>". The first job downloads ~10 GB of model files.
4. Check the result: Roblox Studio → Import 3D → the `.glb` from VAULT.

By hand: `tools\trellis\start.ps1`, then http://127.0.0.1:8189. Settings: `ORBIT_TRELLIS_URL`, `ORBIT_TRELLIS_AUTOSTART=0`.
ORBIT frees the GPU 30 s after a job so pictures and voice can use it.
