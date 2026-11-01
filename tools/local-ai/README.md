# ORBIT local AI tools

Free models that run on this PC. Nothing is uploaded and nothing costs money: the only network use is the one-time
weight download in `setup.ps1`. The service listens on `127.0.0.1:7861` only, runs one job at a time and unloads each
GPU model after its job (a 6 GB laptop GPU never holds two).

**Status: untested on Windows and on a GPU.** It was written in a cloud box without either. `/health`, the refusals and
Kokoro voiceover were run there on CPU (Linux); Picture to 3D and own-voice cloning were never run.

| Tool | What it does | Model | VRAM | License |
|---|---|---|---|---|
| Picture to 3D | Turns one picture of an object into a 3D model (`.glb`) you can import into Roblox Studio or Unreal | TripoSR (Stability AI + Tripo) | about 6 GB at default settings; ORBIT uses half the chunk size to leave headroom; falls back to CPU (slow) | MIT |
| Background cut-out | Cuts the subject out of a picture (PNG with transparency), for thumbnails or before 3D | rembg u2net | CPU | MIT |
| Voiceover | Reads a script aloud in a preset voice (English) | Kokoro 82M (ONNX) | CPU, no GPU needed | Apache-2.0 |
| Own-voice cloning | Reads a script in **your own** voice from a short recording of you | Audio8 TTS Realistic 0.6B | about 3 GB in bf16 (fits 6 GB); CPU works but is slow | Apache-2.0 |

Text to 3D inside Roblox does not need this service: ORBIT already asks Roblox Studio's own `generate_mesh` tool
(GAME DEV → Assets → Text to 3D) through the Studio MCP bridge.

## Setup (once)

1. Install Python 3.11 and Git: `winget install Python.Python.3.11` and `winget install Git.Git`.
2. For Picture to 3D only: `winget install Microsoft.VisualStudio.2022.BuildTools`, then in the Visual Studio Installer tick
   **Desktop development with C++** (one library, torchmcubes, is compiled during setup).
3. In the ORBIT folder: `powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1`
   (add `-SkipClone` to skip the 2.6 GB voice-cloning model, `-Skip3D` to skip Picture to 3D).

## Run

`powershell -ExecutionPolicy Bypass -File tools\local-ai\start.ps1` and leave the window open. ORBIT finds it at
`ORBIT_LOCAL_AI_URL` (default `http://127.0.0.1:7861`; ORBIT refuses any address that isn't this PC).
OPERATIONS → Local AI shows what is installed and running.

If 3D runs out of GPU memory: close games/browser tabs using the GPU, or set `ORBIT_TRIPOSR_CHUNK=2048` before `start.ps1`.

## Not included, and why

- **Hunyuan3D-2 mini**: its license excludes the EU, UK and South Korea, and shape generation alone needs about 6 GB.
- **Stable Fast 3D**: better textures, but the weights are gated (Hugging Face login) and it is free only under $1M revenue a year. A possible upgrade.
- **NVIDIA MotionBricks**: an early research preview built around a robot (Unitree G1) skeleton with an Unreal demo. Its output isn't a Roblox R15 animation. Left for later.
- **Paradee**: a distilled Kokoro with one voice. Kokoro itself already runs on CPU and has several voices.
