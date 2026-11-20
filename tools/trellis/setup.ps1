# ORBIT best-quality picture → 3D (Microsoft TRELLIS.2): one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\trellis\setup.ps1
# Installs a SEPARATE ComfyUI (own Python 3.12 + PyTorch 2.10 CUDA 13.0) and uses ComfyUI's NATIVE TRELLIS.2 nodes (in core
# since v0.34.0): no custom node pack and no compiled CUDA helpers. The old setup used Aero-Ex/ComfyUI-Trellis2-GGUF with
# nvdiffrast + nvdiffrec_render (NVIDIA Source Code License: non-commercial only); this one removes them, so the meshes can
# be used in a game that makes money. Every component and its license: tools\trellis\README.md → Licenses.
# Everything is pinned; model weights (~8.9 GB) are downloaded here, pinned to a Hugging Face commit and SHA-256 checked.
# ORBIT then starts it by itself on 127.0.0.1:8189 (start.ps1 runs it by hand). Re-running skips finished parts.
# Needs git and an NVIDIA driver 580 or newer (CUDA 13.0).
# UNTESTED on the GPU: the native-node version was written in a cloud box (2026-11-20). Run tools\trellis\smoke.ts after setup.

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$UvDir = Join-Path $Here "uv"
$Uv = Join-Path $UvDir "uv.exe"
$Env = Join-Path $Here "env"
$Py = Join-Path $Env "Scripts\python.exe"
$Comfy = Join-Path $Here "ComfyUI"
$Models = Join-Path $Comfy "models"

$UvVersion = "0.13.9"
$ComfyRepo = "https://github.com/comfyanonymous/ComfyUI.git"; $ComfyRev = "a277b5bf213e8a44fa34817b7770b54f86ef4cea" # v0.46.0, GPL-3.0
$TorchIndex = "https://download.pytorch.org/whl/cu130"; $Torch = @("torch==2.10.0", "torchvision==0.25.0")
# Model files: Comfy-Org's repackaged TRELLIS.2 (MIT, from microsoft/TRELLIS.2-4B; its DINOv3 image encoder is under Meta's
# DINOv3 License) and BiRefNet (MIT) for the background cut. Pinned commits; sizes and SHA-256 from the Hugging Face API.
$TrellisHf = "https://huggingface.co/Comfy-Org/TRELLIS.2/resolve/430a9d09b2416687018c8fe8edced2ad4858a439"
$BiRefNetHf = "https://huggingface.co/Comfy-Org/BiRefNet/resolve/884af709e9b795d89dafbf97f29c8d6a2386f5c6"
$Weights = @(
  @{ Path = "diffusion_models\trellis_2_int8_convrot.safetensors"; Url = "$TrellisHf/diffusion_models/trellis_2_int8_convrot.safetensors"; Bytes = 5253048192; Sha = "d01952ad137213f6a868f86b6b877026276f84af5eec23069217475a0bad3a31" },
  @{ Path = "vae\trellis_2_shape_vae_bf16.safetensors"; Url = "$TrellisHf/vae/trellis_2_shape_vae_bf16.safetensors"; Bytes = 1095844024; Sha = "de0cb4949a76c59ee5c091a995a69bcc8c51d5aeda939f0c641a50d2a72341f4" },
  @{ Path = "vae\trellis_2_texture_vae_bf16.safetensors"; Url = "$TrellisHf/vae/trellis_2_texture_vae_bf16.safetensors"; Bytes = 948461364; Sha = "714e5ebf094a610e12a8e3b5175c18a62f37f6ea4218acb6073644456b73ab0e" },
  @{ Path = "clip_vision\dino_v3_vit_l.safetensors"; Url = "$TrellisHf/clip_vision/dino_v3_vit_l.safetensors"; Bytes = 1212559776; Sha = "5cb785e458de7c460579082418af81f5c62380c181599344bdc60898c63468ee" },
  @{ Path = "background_removal\birefnet.safetensors"; Url = "$BiRefNetHf/background_removal/birefnet.safetensors"; Bytes = 444473596; Sha = "9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154" }
)
# Left over from the old setup (non-commercial or no longer needed): removed from the env and custom_nodes on every run.
$OldPackages = @("nvdiffrast", "nvdiffrec_render", "cumesh", "flex_gemm", "o_voxel")
$OldNodes = @("ComfyUI-Trellis2-GGUF", "ComfyUI-GGUF")
# Must never be importable here (checked at the end): NVIDIA's non-commercial rasterizer/renderer and kaolin (same license).
$Forbidden = @("nvdiffrast", "nvdiffrec_render", "nvdiffrec", "kaolin")

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Warn($t) { Write-Host "!! $t" -ForegroundColor Yellow }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "Failed ($LASTEXITCODE): $exe $($a -join ' ')" } }
function Pin($dir, $repo, $rev) {
  if (-not (Test-Path (Join-Path $dir ".git"))) { Run git @("clone", "--filter=blob:none", $repo, $dir) }
  Run git @("-C", $dir, "fetch", "--depth", "1", "origin", $rev)
  Run git @("-C", $dir, "checkout", "--force", $rev)
}
# curl.exe ships with Windows 10/11: resumes (-C -) and retries a dropped connection.
function Fetch($url, $out) {
  for ($i = 1; $i -le 4; $i++) {
    & curl.exe -L --fail --retry 5 --retry-delay 10 -C - -o $out $url
    if ($LASTEXITCODE -eq 0) { return }
    if ($i -lt 4) { Warn "Download stopped (try $i of 4). Continuing in 15 s..."; Start-Sleep 15 }
  }
  throw "Download failed 4 times: $url. Check the internet connection and run setup.ps1 again; it continues where it stopped."
}
function InstallModel($w) {
  $path = Join-Path $Models $w.Path
  if ((Test-Path $path) -and ((Get-Item $path).Length -eq $w.Bytes)) {
    if ((Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant() -eq $w.Sha) { Write-Host "ok  $($w.Path)"; return }
    Warn "$($w.Path) failed its SHA-256 check. Downloading a fresh copy."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  Write-Host "Downloading $($w.Path) ($([math]::Round($w.Bytes / 1GB, 1)) GB)"
  Fetch $w.Url "$path.part"
  $actual = (Get-FileHash -Algorithm SHA256 "$path.part").Hash.ToLowerInvariant()
  if ($actual -ne $w.Sha) { Remove-Item -Force "$path.part"; throw "The download for $($w.Path) failed its SHA-256 check. Run setup.ps1 to download it again." }
  Move-Item -Force "$path.part" $path
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is missing: winget install Git.Git, then run this again." }
try { $smi = & nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null; Write-Host "GPU: $smi" } catch { Warn "nvidia-smi not found; TRELLIS.2 needs an NVIDIA GPU." }

Step "uv $UvVersion (Python/package manager, kept inside tools\trellis)"
if (-not (Test-Path $Uv)) {
  New-Item -ItemType Directory -Force -Path $UvDir | Out-Null
  $zip = Join-Path $UvDir "uv.zip"
  & curl.exe -L --fail --retry 5 -o $zip "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
  if ($LASTEXITCODE -ne 0) { throw "Couldn't download uv." }
  Expand-Archive -Force $zip $UvDir; Remove-Item $zip
}

Step "Python 3.12 environment"
if (-not (Test-Path $Py)) { Run $Uv @("venv", "--python", "3.12", $Env) }
$env:VIRTUAL_ENV = $Env

Step "PyTorch 2.10 (CUDA 13.0)"
Run $Uv (@("pip", "install", "--python", $Py) + $Torch + @("--index-url", $TorchIndex))

Step "ComfyUI v0.46.0 (native TRELLIS.2 nodes)"
Pin $Comfy $ComfyRepo $ComfyRev
Run $Uv @("pip", "install", "--python", $Py, "-r", (Join-Path $Comfy "requirements.txt"))
# ComfyUI's requirements can pull a CPU torch from PyPI: put the CUDA build back.
Run $Uv (@("pip", "install", "--python", $Py, "--reinstall") + $Torch + @("--index-url", $TorchIndex))

Step "Remove the old non-commercial parts (nvdiffrast, nvdiffrec_render) and the old node packs"
foreach ($n in $OldNodes) {
  $d = Join-Path $Comfy "custom_nodes\$n"
  if (Test-Path $d) { Remove-Item -Recurse -Force $d; Write-Host "removed custom_nodes\$n" }
}
$installed = (& $Uv pip list --python $Py --format freeze) | ForEach-Object { ($_ -split "==")[0].ToLowerInvariant().Replace("-", "_") }
$stale = @($OldPackages | Where-Object { $installed -contains $_ })
if ($stale.Count) { Run $Uv (@("pip", "uninstall", "--python", $Py) + $stale) }

Step "Model files (~8.9 GB, pinned + SHA-256 checked)"
foreach ($w in $Weights) { InstallModel $w }

Step "Check"
$check = "import importlib.util as u, sys, torch, scipy, comfy_kitchen; bad=[m for m in sys.argv[1:] if u.find_spec(m)]; " +
  "sys.exit('non-commercial package still installed: ' + ', '.join(bad)) if bad else None; " +
  "print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '-')"
Run $Py (@("-c", $check) + $Forbidden)
Write-Host "`nDone. ORBIT starts TRELLIS.2 by itself; ask CORE for a 'best' 3D model from a VAULT picture." -ForegroundColor Green
Write-Host "Check it once: node --experimental-strip-types tools\trellis\smoke.ts   Log: tools\trellis\service.log"
Write-Host "Old GGUF weights from the previous setup can be deleted from tools\trellis\ComfyUI\models to free disk space."
