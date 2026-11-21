# ORBIT local AI tools

Free models that run on this PC. Nothing is uploaded and nothing costs money: the only network use is the one-time
weight download in `setup.ps1`. The service listens on `127.0.0.1:7861` only, runs one job at a time and unloads each
GPU model after its job (a laptop GPU never holds two).

**Status: untested on Windows and on a GPU.** It was written in a cloud box without either. `/health`, the refusals and
Kokoro voiceover were run there on CPU (Linux); Picture to 3D and own-voice cloning were never run.

| Tool | What it does | Model | VRAM | License |
|---|---|---|---|---|
| Picture to 3D | Turns one picture of an object into a 3D model (`.glb`) you can import into Roblox Studio or Unreal | TripoSR (Stability AI + Tripo) | about 6 GB at default settings; ORBIT uses half the chunk size to leave headroom; falls back to CPU (slow) | MIT |
| Background cut-out | Cuts the subject out of a picture (PNG with transparency), for thumbnails or before 3D | BiRefNet lite (MIT) via rembg; u2net is the fallback | CPU, several GB of RAM at 1024 px | MIT |
| Voiceover | Reads a script aloud in a preset voice (English) | Kokoro 82M (ONNX) | CPU, no GPU needed | Apache-2.0 |
| Own-voice cloning | Reads a script in **your own** voice from a short recording of you | Audio8 TTS Realistic 0.6B | about 3 GB in bf16 (fits 6 GB); CPU works but is slow | Apache-2.0 |
| Captions *(optional, `-Captions`)* | Writes down speech in a video/recording (English, Estonian) → `.srt`, `.vtt` and a clean transcript | Whisper large-v3-turbo via faster-whisper 1.2.1 / CTranslate2 4.8.3 | about 2-3 GB in float16; CPU int8 fallback | MIT |
| IFC models *(optional, `-Ifc`)* | Opens an `.ifc` model: storeys, spaces with areas, element counts, materials, simple checks, spaces CSV | IfcOpenShell 0.9.0.post1 | CPU | LGPL-3.0 |
| Bilingual dub *(optional, `-Dub`)* | STUDIO: says each line of an approved Short in English or Estonian **in your own voice** (from your consented sample in Settings) | A plain voice (Kokoro for English, Piper `et_EE-news-medium` for Estonian), then the OpenVoice V2 tone colour converter turns it into your voice | CPU (the converter is ~130 MB and stays off the GPU) | OpenVoice V2 code + weights MIT ("free for commercial use"); Piper voice MIT (TartuNLP data CC-BY); Piper runtime GPL-3.0; Kokoro Apache-2.0 |
| Document reading *(optional, `-Docs`)* | PDF / Word / PowerPoint / scanned page → Markdown with tables, saved beside the original in VAULT | Docling 2.139.0 (layout + TableFormer + RapidOCR) | about 2 GB; CPU works | MIT |
| Photo scan *(optional, `-Scan`)* | ARCH: 3-10 photos of a room, facade or object → a point cloud (`.ply` in VAULT) you walk around and measure; one known length (a door) sets the size | Depth Anything 3 BASE 0.12 B (`depth-anything-3` 0.1.1, weights pinned + SHA-256 checked) | estimated 1-2 GB for 10 photos (unmeasured; the model is 0.12 B); CPU works (8 photos: 27 s on a 2-core cloud CPU) | Apache-2.0 (code and these weights); addict MIT |

Text to 3D inside Roblox does not need this service: ORBIT already asks Roblox Studio's own `generate_mesh` tool
(GAME DEV → Assets → Text to 3D) through the Studio MCP bridge.

## Setup (once)

1. Install Python 3.11 and Git: `winget install Python.Python.3.11` and `winget install Git.Git`.
2. For Picture to 3D only: `winget install Microsoft.VisualStudio.2022.BuildTools`, then in the Visual Studio Installer tick
   **Desktop development with C++** (one library, torchmcubes, is compiled during setup).
3. In the ORBIT folder: `powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1`
   (add `-SkipClone` to skip the 2.6 GB voice-cloning model, `-Skip3D` to skip Picture to 3D).

### Optional modules (add later; the main setup must have run once)

`powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1 -Captions` (or `-Ifc`, `-Docs`, or `-Extras` for all three; `-Dub` for the bilingual dub; `-Scan` for the ARCH photo scan).
Only the chosen modules are installed; what's already there is skipped, torch is left alone, and every version is pinned
(`constraints.txt`, resolved for Windows + Python 3.11 with torch 2.7.1). Restart `start.ps1` afterwards.

- **Captions on the GPU** use CTranslate2's CUDA 12.8 build. Its cuBLAS/cuDNN DLLs come from the torch 2.7.1+cu128 that is
  already installed (server.py imports torch first), so no CUDA toolkit is needed. CTranslate2 has no INT8 on RTX 50-series
  (sm_120), so it runs in float16 there. If the GPU fails (missing DLL, out of memory) the job reruns on the CPU in int8.
- **Docling** runs its layout and table models with torch (GPU when there is one) and OCR with RapidOCR (ONNX, CPU).
  Its models are downloaded once into `models\docling`; while running it reads nothing from the internet.

## Run

`powershell -ExecutionPolicy Bypass -File tools\local-ai\start.ps1` and leave the window open. ORBIT finds it at
`ORBIT_LOCAL_AI_URL` (default `http://127.0.0.1:7861`; ORBIT refuses any address that isn't this PC).
OPERATIONS → Local AI shows what is installed and running.

Background cut-out uses BiRefNet lite and falls back to u2net if it fails to load or run. For the cleaner, heavier model run `setup.ps1 -CutoutModel birefnet-general` and set `ORBIT_CUTOUT_MODEL=birefnet-general` before `start.ps1` (`u2net` restores the old one). Never RMBG-2.0: its weights are non-commercial.

If 3D runs out of GPU memory: close games/browser tabs using the GPU, or set `ORBIT_TRIPOSR_CHUNK=2048` before `start.ps1`.

## Photo scan (ARCH)

ARCH → Studio → **Photos to 3D scan**: pick 3-10 photos (on the phone, open ORBIT's ARCH page in the browser: Pick photos opens the
camera roll), press Make 3D scan. The "Working on it" card shows the steps; when it is done, Open turns Measure on: click the top and
bottom of a door, type its real height, and every length is in metres. One feed-forward pass of Depth Anything 3 BASE gives each
photo's depth and camera; ORBIT lifts the sure pixels (top 60 % by the model's own confidence) into one point cloud, turns it upright
from the cameras (phones are held level) and writes the same 3DGS `.ply` layout the Scaniverse import uses. The photos are not saved.

Accuracy, measured honestly (2026-11-21, CPU, on a synthetic room with exact geometry, 4 × 2.6 × 5 m, rendered with Poly Haven CC0
textures, 8 photos 640 × 480, sized on the door): single lengths read off one photo's area were within 0.1-2.3 % (room height
+0.9 %, door width +1.4 %, window 1.44 m → 1.47 m, wall 3.96 m → 4.02 m), one was +6.8 % (table length, seen at a steep angle).
Across all photos together the median point sat 9 cm (90 % within 16 cm) from the true surface, cameras within 0.7° (median).
With 5 photos spread too far apart the error doubled (median 19 cm, cameras 3.5°): overlap matters more than the count. Real
phone photos were not tested (no GPU or Windows here); white walls without texture and mirrors/glass will be worse. "Up" was
right to within 0.75°; when every photo faces the same way and tilts, the tilt stays in (the viewer's ↕ flip only fixes upside
down). Not used on purpose: VGGT-1B and DA3 LARGE/GIANT (CC BY-NC), MASt3R/DUSt3R (CC BY-NC-SA), VGGT-1B-Commercial (gated
behind a Meta login and no military use; also ~4x bigger). DA3METRIC-LARGE (Apache-2.0) could later guess metres without a door.

## Not included, and why

- **Hunyuan3D-2 mini**: its license excludes the EU, UK and South Korea, and shape generation alone needs about 6 GB.
- **Stable Fast 3D**: better textures, but the weights are gated (Hugging Face login) and it is free only under $1M revenue a year. A possible upgrade.
- **NVIDIA MotionBricks**: an early research preview built around a robot (Unitree G1) skeleton with an Unreal demo. Its output isn't a Roblox R15 animation. Left for later.
- **Paradee**: a distilled Kokoro with one voice. Kokoro itself already runs on CPU and has several voices.
- **Bilingual dub, what was left out**: XTTSv2 / Coqui (CPML licence is non-commercial); Chatterbox (MIT, good, but no Estonian among its 23 languages);
  F5-TTS and Fish Speech (non-commercial weights). Separating your voice from the background uses Spleeter 2-stems (Deezer, MIT) through
  sherpa-onnx in ORBIT itself, not Demucs: Demucs' code is MIT but its pretrained weights have no clear licence statement. Lip-sync is
  not done: the commercial-OK candidates (e.g. MuseTalk 1.5, MIT) need a GPU pipeline that couldn't be tested here; Wav2Lip is research-only.
