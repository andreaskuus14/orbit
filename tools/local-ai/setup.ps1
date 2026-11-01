# ORBIT local AI tools: one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1            (everything, ~6 GB download)
#   powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1 -SkipClone (no own-voice cloning, saves 2.6 GB)
# Installs into tools\local-ai\.venv, tools\local-ai\models and tools\local-ai\vendor (all git-ignored). Safe to run again.
# Needs: Python 3.11 (winget install Python.Python.3.11), Git, and for Picture to 3D the
# "Desktop development with C++" workload of Visual Studio 2022 Build Tools (torchmcubes is compiled on install).
# UNTESTED on Windows/GPU: written in a cloud box. If a step fails it says which tool is affected and the rest still installs.
param([switch]$SkipClone, [switch]$Skip3D)
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Venv = Join-Path $Here ".venv"
$Py = Join-Path $Venv "Scripts\python.exe"
$Models = Join-Path $Here "models"
$env:HF_HOME = Join-Path $Models "hf"
$env:U2NET_HOME = Join-Path $Models "rembg"

# Pinned versions (bump deliberately, never "latest")
$TorchVer = "2.7.1"  # CUDA 12.8 build: the first that runs RTX 50-series (sm_120); server.py loads TripoSR's checkpoint with weights_only=False
$TripoSRCommit = "107cefdc244c39106fa830359024f6a2f1c78871"
$TorchMcubesCommit = "a9ac95aa329957ba646e7bb057f825f5dfa77f38"
$TripoSRRev = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
$Audio8Rev = "1e857568bfd4f02931aca3988ee773a44d2d26d3"
$Kokoro = @(
  @{ Name = "kokoro-v1.0.onnx"; Sha = "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a" },
  @{ Name = "voices-v1.0.bin"; Sha = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" }
)

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Warn($t) { Write-Host "!! $t" -ForegroundColor Yellow }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') failed ($LASTEXITCODE)" } }
# Big downloads (torch is 2.4 GB) can be cut off midway; pip then reports a hash mismatch for the partial file. Try 3 times.
# Model downloads: huggingface_hub resumes a partial file, so a retry after a dropped connection continues where it stopped.
function RunTries($exe, [string[]]$a) {
  for ($i = 1; $i -le 4; $i++) {
    & $exe @a
    if ($LASTEXITCODE -eq 0) { return }
    if ($i -lt 4) { Warn "Download stopped (try $i of 4; the connection dropped?). Continuing in 15 s..."; Start-Sleep 15 }
  }
  throw "Model download failed 4 times. Check the internet connection and run setup.ps1 again; it continues where it stopped."
}
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
function RunRetry($exe, [string[]]$a) {
  for ($i = 1; $i -le 3; $i++) {
    & $exe @a "--retries" "10" "--timeout" "120"
    if ($LASTEXITCODE -eq 0) { return }
    if ($i -lt 3) { Warn "Download failed or was cut off (try $i of 3); trying again..." }
  }
  throw "$exe $($a -join ' ') failed 3 times. Check the internet connection and run setup.ps1 again; finished parts are kept."
}

Step "Python 3.11 and Git"
& py -3.11 -c "import sys; print(sys.version)"
if ($LASTEXITCODE -ne 0) { throw "Python 3.11 not found. Install it: winget install Python.Python.3.11  (then open a new PowerShell)" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git not found. Install it: winget install Git.Git" }

Step "Virtual environment ($Venv)"
if (-not (Test-Path $Py)) { Run py @("-3.11", "-m", "venv", $Venv) }
Run $Py @("-m", "pip", "install", "--upgrade", "pip==24.3.1", "setuptools==75.6.0", "wheel==0.45.1")

Step "PyTorch $TorchVer (CUDA 12.8 build: RTX 20/30/40/50-series)"
RunRetry $Py @("-m", "pip", "install", "torch==$TorchVer", "torchaudio==$TorchVer", "--index-url", "https://download.pytorch.org/whl/cu128")

Step "Python packages (pinned: requirements.txt + constraints.txt)"
RunRetry $Py @("-m", "pip", "install", "-r", (Join-Path $Here "requirements.txt"), "-c", (Join-Path $Here "constraints.txt"))

Step "Kokoro voices (CPU text-to-speech, ~350 MB)"
$kdir = Join-Path $Models "kokoro"; New-Item -ItemType Directory -Force $kdir | Out-Null
foreach ($f in $Kokoro) {
  $dest = Join-Path $kdir $f.Name
  if (-not (Test-Path $dest) -or (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -ne $f.Sha) {
    Invoke-WebRequest "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/$($f.Name)" -OutFile $dest
    if ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -ne $f.Sha) { Remove-Item $dest; throw "$($f.Name): checksum mismatch, download refused" }
  }
}

Step "Background cut-out model (rembg u2net, ~170 MB)"
Run $Py @("-c", "import rembg; rembg.new_session(); print('rembg ready')")

if (-not $Skip3D) {
  Step "Picture to 3D: TripoSR (MIT) at $TripoSRCommit"
  $src = Join-Path $Here "vendor\TripoSR"
  if (-not (Test-Path (Join-Path $src ".git"))) { Run git @("clone", "https://github.com/VAST-AI-Research/TripoSR", $src) }
  Run git @("-C", $src, "fetch", "--quiet", "origin", $TripoSRCommit)
  Run git @("-C", $src, "checkout", "--quiet", $TripoSRCommit)
  try {
    # Builds a C++ extension: needs Visual Studio 2022 Build Tools (C++). Without the CUDA toolkit it builds the CPU version, which TripoSR falls back to.
    # --no-build-isolation builds against the installed torch, so its build tools must be here first.
    RunRetry $Py @("-m", "pip", "install", "scikit-build-core==1.0.3", "pybind11==2.13.6", "cmake==3.31.6", "ninja==1.11.1.4")
    # Rebuilt every run: a C++ extension only works with the torch it was built against.
    Run $Py @("-m", "pip", "install", "--force-reinstall", "--no-deps", "--no-build-isolation", "git+https://github.com/tatsy/torchmcubes.git@$TorchMcubesCommit")
  } catch {
    Warn "torchmcubes did not build, so Picture to 3D stays off. Install 'Visual Studio 2022 Build Tools' with 'Desktop development with C++' (winget install Microsoft.VisualStudio.2022.BuildTools), open a new PowerShell and run setup.ps1 again."
  }
  RunTries $Py @("-c", "from huggingface_hub import hf_hub_download as d; [d('stabilityai/TripoSR', f, revision='$TripoSRRev', local_dir=r'$Models\TripoSR') for f in ('config.yaml', 'model.ckpt')]; d('facebook/dino-vitb16', 'config.json'); print('TripoSR weights ready')")
}

if (-not $SkipClone) {
  Step "Own-voice cloning: Audio8 TTS Realistic 0.6B (Apache-2.0, ~2.6 GB)"
  RunTries $Py @("-c", "from huggingface_hub import snapshot_download as s; s('Edge0/Audio8-TTS-Realistic-0.6b', revision='$Audio8Rev', local_dir=r'$Models\audio8', ignore_patterns=['assets/*', '*.jpeg']); print('Audio8 ready')")
}

Step "Check"
Run $Py @("-c", "import torch; print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none (CPU only: 3D and cloning will be slow)')")
Write-Host "`nDone. Start the service with:  powershell -ExecutionPolicy Bypass -File tools\local-ai\start.ps1" -ForegroundColor Green
