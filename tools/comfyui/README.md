# ORBIT local pictures (ComfyUI)

Realistic photos made on this PC: free, unlimited, nothing uploaded. ORBIT uses it first for website photos
(`ws_picture_draft`, before the online free service), for CORE's `local_image` tool (pictures saved in VAULT) and for
**STUDIO → Websites → Generate locally**. It is a separate service from `tools/local-ai` (own Python, own PyTorch),
listening on `127.0.0.1:8188` only.

**Status: untested on Windows and on a GPU.** Written in a cloud box without either; the workflow JSON and the reply
parsing are unit-tested (`tests/comfy.test.ts`), the install and a real generation were never run.

| | |
|---|---|
| App | [ComfyUI](https://github.com/comfyanonymous/ComfyUI) Windows portable, NVIDIA build (Python 3.13, PyTorch CUDA 13.0; RTX 50 / sm_120 supported). GPL-3.0 |
| Model | [SDXL-Lightning](https://huggingface.co/ByteDance/SDXL-Lightning) 4-step full checkpoint (`sdxl_lightning_4step.safetensors`, 6.9 GB, pinned revision + SHA-256) |
| License | CreativeML Open RAIL++-M: commercial use of the pictures is allowed; the license forbids harmful uses (deception, harassment, etc.) |
| VRAM | about 6 GB at 1024 px; fits the RTX 5060 Laptop's 8 GB. ComfyUI moves parts to RAM if needed |
| Speed | first picture ~1 min (model load), then roughly 5-10 s each. ORBIT unloads the model 2 min after the last picture |

Why this model: one file, only ComfyUI's built-in nodes, 4 steps, fits 8 GB comfortably and allows commercial use.
FLUX.1-schnell (Apache-2.0) looks better but needs a custom GGUF node plus three extra files (T5, CLIP, VAE) and is
several times slower on 8 GB; it can be added later as a second workflow.

## Setup (once)

1. Update the NVIDIA driver to 580 or newer (NVIDIA app → Drivers). `nvidia-smi` shows the version.
2. Optional: `winget install 7zip.7zip` (Windows 11 can unpack it without, older Windows can't).
3. In the ORBIT folder: `powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1` (about 9 GB download).
4. OPERATIONS → Local AI → "Pictures (unlimited)" shows Ready once ORBIT has started it (it starts by itself).

By hand: `tools\comfyui\start.ps1`, then open http://127.0.0.1:8188. `workflow-txt2img.json` is the exact graph ORBIT
sends (API format); it is copied into ComfyUI's `user` folder so you can look at it.

## NitroFusion2 (optional)

NitroFusion2 is a local text-to-image model. ORBIT runs its upstream one-step recipe in the same ComfyUI service, using the [W4A8 GPTQ weights](https://huggingface.co/PedroMarinhoDev/NitroFusion2-ComfyUI) linked by the [NitroFusion2 authors](https://github.com/ChenDarYen/NitroFusion2). This workflow uses stock ComfyUI nodes. The weights, Qwen encoder and VAE take about 12 GB of disk space in total, in addition to ComfyUI. Use a current ComfyUI build with support for the W4A8 weights. GPU memory use and generation times on the ORBIT PC still need to be measured.

1. In the ORBIT folder, run `powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1 -Model nitrofusion2`.
2. Add `ORBIT_COMFY_MODEL=nitrofusion2` to `.env.local` and restart ORBIT.
3. Ask CORE for a local picture. Confirm it opens from VAULT and that **OPERATIONS → Local AI** shows NitroFusion2.

The model choice also applies to local website pictures. To switch back, clear `ORBIT_COMFY_MODEL`, run the regular setup if SDXL-Lightning is missing, and restart. Each setup command installs only the selected model files.

## Settings (`.env.local`, all optional)

- `ORBIT_COMFY_URL` — default `http://127.0.0.1:8188`; must be this PC.
- `ORBIT_COMFY_AUTOSTART=0` — don't start ComfyUI automatically.
- `ORBIT_COMFY_MODEL=nitrofusion2` — select NitroFusion2 for local image generation. Empty uses SDXL-Lightning.
- `ORBIT_LOCAL_PICTURES=0` — website photos skip ComfyUI and use the online free service.

## Browser for CORE

The `browse` tool and page watch's "JS page" option use the Chrome or Edge already on this PC (through `playwright-core`,
already in ORBIT's packages): nothing to install. Without either, run `npx playwright install chromium` once.
