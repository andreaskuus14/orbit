# ORBIT best-quality picture → 3D (Microsoft TRELLIS.2): one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\trellis\setup.ps1
# Installs a SEPARATE ComfyUI with its own Python 3.12 (TRELLIS.2's CUDA helpers have Windows wheels only for Python 3.11/3.12,
# while tools\comfyui uses 3.13), PyTorch 2.10 CUDA 13.0 (ComfyUI warns CUDA 12.x is very slow on RTX 50) and the Aero-Ex/ComfyUI-Trellis2-GGUF nodes.
# Everything is pinned. Model weights (~10 GB: TRELLIS.2 GGUF + DINOv3 encoder) download on the first 3D job.
# ORBIT then starts it by itself on 127.0.0.1:8189 (start.ps1 runs it by hand). Re-running skips finished parts.
# Needs git and an NVIDIA driver 580 or newer (CUDA 13.0). First run on the RTX 5060 Laptop (2026-11-19): the node pack's own
# installer picked no CUDA wheels, so the five CUDA helpers are now installed from exact URLs below.

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$UvDir = Join-Path $Here "uv"
$Uv = Join-Path $UvDir "uv.exe"
$Env = Join-Path $Here "env"
$Py = Join-Path $Env "Scripts\python.exe"
$Comfy = Join-Path $Here "ComfyUI"
$Nodes = Join-Path $Comfy "custom_nodes\ComfyUI-Trellis2-GGUF"

$UvVersion = "0.13.9"
$ComfyRepo = "https://github.com/comfyanonymous/ComfyUI.git"; $ComfyRev = "a277b5bf213e8a44fa34817b7770b54f86ef4cea" # v0.46.0
$NodesRepo = "https://github.com/Aero-Ex/ComfyUI-Trellis2-GGUF.git"; $NodesRev = "b3b9e951874c5fb5c936566c93b908299be08b2c" # MIT
$TorchIndex = "https://download.pytorch.org/whl/cu130"; $Torch = @("torch==2.10.0", "torchvision==0.25.0")
# Prebuilt CUDA helpers for exactly Python 3.12 + torch 2.10 + CUDA 13.0 on Windows (PozzettiAndrea/cuda-wheels, the node pack's source).
$WheelBase = "https://github.com/PozzettiAndrea/cuda-wheels/releases/download"
$Wheels = @(
  "cumesh-latest/cumesh-0.0.1%2Bcu130torch2.10-cp312-cp312-win_amd64.whl",
  "flex_gemm-latest/flex_gemm-1.0.0%2Bcu130torch2.10-cp312-cp312-win_amd64.whl",
  "o_voxel-latest/o_voxel-0.0.1%2Bcu130torch2.10-cp312-cp312-win_amd64.whl",
  "nvdiffrast-latest/nvdiffrast-0.4.0%2Bcu130torch2.10-cp312-cp312-win_amd64.whl",
  "nvdiffrec_render-latest/nvdiffrec_render-0.0.1%2Bcu130torch2.10-cp312-cp312-win_amd64.whl"
)

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "Failed ($LASTEXITCODE): $exe $($a -join ' ')" } }
function Pin($dir, $repo, $rev) {
  if (-not (Test-Path (Join-Path $dir ".git"))) { Run git @("clone", "--filter=blob:none", $repo, $dir) }
  Run git @("-C", $dir, "fetch", "--depth", "1", "origin", $rev)
  Run git @("-C", $dir, "checkout", "--force", $rev)
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is missing: winget install Git.Git, then run this again." }
try { $smi = & nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null; Write-Host "GPU: $smi" } catch { Write-Host "!! nvidia-smi not found; TRELLIS.2 needs an NVIDIA GPU." -ForegroundColor Yellow }

Step "uv $UvVersion (Python/package manager, kept inside tools\trellis)"
if (-not (Test-Path $Uv)) {
  New-Item -ItemType Directory -Force -Path $UvDir | Out-Null
  $zip = Join-Path $UvDir "uv.zip"
  & curl.exe -L --fail --retry 5 -o $zip "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
  if ($LASTEXITCODE -ne 0) { throw "Couldn't download uv." }
  Expand-Archive -Force $zip $UvDir; Remove-Item $zip
}

Step "Python 3.12 environment"
if (-not (Test-Path $Py)) { Run $Uv @("venv", "--python", "3.12", "--seed", $Env) } # --seed adds pip: the node pack's install.py uses it
$env:VIRTUAL_ENV = $Env

Step "PyTorch 2.10 (CUDA 13.0)"
Run $Uv (@("pip", "install", "--python", $Py) + $Torch + @("--index-url", $TorchIndex))

Step "ComfyUI v0.46.0"
Pin $Comfy $ComfyRepo $ComfyRev
Run $Uv @("pip", "install", "--python", $Py, "-r", (Join-Path $Comfy "requirements.txt"))
# ComfyUI's requirements can pull a CPU torch from PyPI: put the CUDA build back.
Run $Uv (@("pip", "install", "--python", $Py, "--reinstall") + $Torch + @("--index-url", $TorchIndex))

Step "TRELLIS.2 nodes + CUDA helper wheels (cumesh, nvdiffrast, flex_gemm, o_voxel)"
Pin $Nodes $NodesRepo $NodesRev
Run $Uv (@("pip", "install", "--python", $Py) + ($Wheels | ForEach-Object { "$WheelBase/$_" }))
Push-Location $Nodes
# requirements.txt, triton-windows and its patches for cumesh/o_voxel (needs the wheels above installed first)
try { Run $Py @("install.py") } finally { Pop-Location }
Run $Uv (@("pip", "install", "--python", $Py) + $Torch + @("--index-url", $TorchIndex)) # keep the CUDA 13 torch if anything swapped it

Step "Check"
Run $Py @("-c", "import torch, cumesh, o_voxel, nvdiffrast; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')")
Write-Host "`nDone. ORBIT starts TRELLIS.2 by itself; ask CORE for a 'best' 3D model from a VAULT picture." -ForegroundColor Green
Write-Host "The first job downloads the model files (~10 GB) and takes longer. Log: tools\trellis\service.log"
