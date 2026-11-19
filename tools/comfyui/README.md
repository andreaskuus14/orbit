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

## Local music for Shorts (ACE-Step 1.5, optional)

Original instrumental music beds for STUDIO Shorts and CORE's `local_music` tool, made by [ACE-Step 1.5 turbo](https://huggingface.co/ACE-Step/Ace-Step1.5) (2B, MIT; the model card allows commercial use of the output) in this same ComfyUI, with its built-in nodes only. Free, nothing uploaded.

**Status: untested on a real GPU.** The graph and parsing are unit-tested (`tests/music-gen.test.ts`); generation speed is an estimate (about 15 to 40 s for a 30 to 60 s bed once loaded, plus a first load of about 10 GB from disk). Time it once before relying on it.

1. `powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1 -Model acestep-music` (about 10 GB, pinned revision + SHA-256; the picture model is not needed for this).
2. That is all: when the four files exist, STUDIO tries it first for every Short's music (`pickMusic`), then `ORBIT_ACESTEP_CMD`, then the music folder. A failed generation only logs a warning and falls through; the clip is never blocked.
3. Beds are saved into the studio music folder as `ai-<words>-<seed>.flac` with a `.json` beside each one (prompt, seed, model revision, time): keep it as evidence if YouTube's Content ID ever claims a bed. The folder fallback may reuse these beds later.
4. CORE: `local_music {"prompt", "seconds"?: 15-120, "name"?}` saves a `.flac` + `.json` in VAULT.

Rules: prompts never name artists, bands, songs or "in the style of" (refused: they invite claims). The GPU is freed (`/free`) after every bed because the 8 GB is shared with pictures, voice and captions; ORBIT never runs two ComfyUI jobs at once. Purely AI-generated audio may not be copyrightable: don't register beds in Content ID. If a node is unknown, update ComfyUI (`GET /object_info/TextEncodeAceStepAudio1.5` must answer).

## Local video (Wan 2.2, optional)

CORE's `local_video` makes a short silent `.mp4` clip in VAULT from text, or from a VAULT picture (the picture is the first frame).
Same ComfyUI service and port as the pictures, so nothing is uploaded and nothing is paid. **Status: untested on Windows and on a GPU.**
The graphs and parsing are unit-tested (`tests/video.test.ts`); the install and a real clip were never run.

| | |
|---|---|
| Model | [Wan 2.2 TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B), `Wan2.2-TI2V-5B-Q6_K.gguf` (QuantStack, 4.2 GB), text encoder `umt5-xxl-encoder-Q5_K_M.gguf` (city96, 4.1 GB), `wan2.2_vae.safetensors` (Comfy-Org, 1.4 GB), FastWan speed LoRA (Kijai, 0.66 GB). All Apache-2.0, pinned revisions + SHA-256 |
| Node pack | [city96/ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) pinned at `6ea2651e` (Apache-2.0), installed into the portable `custom_nodes` |
| Clip | 24 fps, 2-5 s (121 frames at 5 s), 832x480 or 480x832 (`aspect`), tiled VAE decode |
| Fast (default) | FastWan LoRA, 4 steps, cfg 1 |
| Best | no LoRA, 20 steps, cfg 5, uni_pc; `ORBIT_VIDEO_HD=1` renders 1280x704 |
| Speed | **UNTESTED.** Estimates only: about 2-4 min per 5 s clip in fast mode at 480p, 6-12 min for best at 720p on the RTX 5060 Laptop. The first clip also loads about 10 GB of weights. Benchmark before relying on it |

Install (once, about 10.5 GB): `powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1 -Model wan22-video`. It needs `git` and
adds to the existing install; run the plain `setup.ps1` as well if the SDXL picture model is missing. ORBIT checks that the GGUF node
loaded (`/object_info/UnetLoaderGGUF`) before queueing and says so if not. When a clip finishes, ORBIT calls ComfyUI's `/free` so pictures and 3D get the GPU back.
Timeout 30 min; Stop-all interrupts the job.

Limits: 16 GB RAM is the tight spot (about 10 GB of weights stay in RAM while sampling), so stop other local AI first and run one clip at a time.
FastWan was distilled on text-to-video only, so check image-to-video quality against `quality: "best"`. Clips have no sound.
If SaveVideo rejects `format.codec` on your ComfyUI build, check `GET /object_info/SaveVideo` (older builds use flat keys).

## Settings (`.env.local`, all optional)

- `ORBIT_COMFY_URL` — default `http://127.0.0.1:8188`; must be this PC.
- `ORBIT_COMFY_AUTOSTART=0` — don't start ComfyUI automatically.
- `ORBIT_COMFY_MODEL=nitrofusion2` — select NitroFusion2 for local image generation. Empty uses SDXL-Lightning.
- `ORBIT_MUSIC_GEN=off` — don't use ACE-Step for Shorts music (music folder / `ORBIT_ACESTEP_CMD` only).

- `ORBIT_VIDEO_HD=1` — local video quality "best" renders 1280x704 instead of 832x480.
- `ORBIT_LOCAL_PICTURES=0` — website photos skip ComfyUI and use the online free service.

## Browser for CORE

The `browse` tool and page watch's "JS page" option use the Chrome or Edge already on this PC (through `playwright-core`,
already in ORBIT's packages): nothing to install. Without either, run `npx playwright install chromium` once.
