# ORBIT local pictures: one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1
# Installs the official ComfyUI Windows portable build (its own embedded Python + PyTorch CUDA 13.0, so tools\local-ai\.venv and
# its torch are never touched) into tools\comfyui\ComfyUI_windows_portable, and the selected image model.
# Downloads are pinned and SHA-256 checked. Finished parts are skipped, a cut-off model download resumes.
# ORBIT then starts ComfyUI by itself on 127.0.0.1:8188 when it needs a picture (start.ps1 runs it by hand).
# UNTESTED on Windows/GPU: written in a cloud box. Needs an NVIDIA driver 580 or newer (CUDA 13.0); the RTX 5060 Laptop is fine.
param([ValidateSet("sdxl-lightning", "nitrofusion2")][string]$Model = "sdxl-lightning")

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Root = Join-Path $Here "ComfyUI_windows_portable"
$Dl = Join-Path $Here "downloads"
$PortableUrl = "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z"
# SDXL-Lightning (ByteDance), CreativeML Open RAIL++-M: commercial use allowed, with the license's use restrictions. Pinned revision.
$ModelFile = "sdxl_lightning_4step.safetensors"
$ModelUrl = "https://huggingface.co/ByteDance/SDXL-Lightning/resolve/c9a24f48e1c025556787b0c58dd67a091ece2e44/$ModelFile"
$ModelSha = "e0d996ee0013e79d9d3561f50fcafb9a17e3ff07b780358e3b66d67932c4d490"
$ModelBytes = 6938040682

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Warn($t) { Write-Host "!! $t" -ForegroundColor Yellow }
# curl.exe ships with Windows 10/11: resumes (-C -) and retries a dropped connection.
function Fetch($url, $out) {
  for ($i = 1; $i -le 4; $i++) {
    & curl.exe -L --fail --retry 5 --retry-delay 10 -C - -o $out $url
    if ($LASTEXITCODE -eq 0) { return }
    if ($i -lt 4) { Warn "Download stopped (try $i of 4). Continuing in 15 s..."; Start-Sleep 15 }
  }
  throw "Download failed 4 times: $url. Check the internet connection and run setup.ps1 again; it continues where it stopped."
}

function InstallModel($RelativePath, $Url, $Sha, [long]$Bytes) {
  if ($Sha -notmatch '^[0-9a-f]{64}$') { throw "Invalid SHA-256 configured for $RelativePath. Update the ORBIT setup script before downloading." }
  $Path = Join-Path $Root "ComfyUI\models\$RelativePath"
  if ((Test-Path $Path) -and ((Get-Item $Path).Length -eq $Bytes)) {
    if ((Get-FileHash -Algorithm SHA256 $Path).Hash -eq $Sha) { return }
    Warn "$RelativePath failed its SHA-256 check. Downloading a fresh copy."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  Write-Host "Downloading $RelativePath"
  Fetch $Url "$Path.part"
  Write-Host "Checking the SHA-256 (a minute)..."
  $actual = (Get-FileHash -Algorithm SHA256 "$Path.part").Hash.ToLowerInvariant()
  if ($actual -ne $Sha) { Remove-Item -Force "$Path.part"; throw "The download for $RelativePath failed its SHA-256 check. Run setup.ps1 to download it again." }
  Move-Item -Force "$Path.part" $Path
}

Step "NVIDIA driver"
$drv = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { (& nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>$null) | Select-Object -First 1 } else { $null }
if (-not $drv) { Warn "nvidia-smi not found: ComfyUI would run on the CPU (very slow). Install the NVIDIA driver first." }
else {
  Write-Host $drv
  $ver = [double](($drv -split ",")[-1].Trim() -replace "^(\d+\.\d+).*", '$1')
  if ($ver -lt 580) { throw "Driver $ver is too old for this ComfyUI build (needs 580+, CUDA 13.0). Update it (NVIDIA app or nvidia.com/drivers), then run setup.ps1 again." }
}

Step "ComfyUI portable ($Root)"
New-Item -ItemType Directory -Force -Path $Dl | Out-Null
if (-not (Test-Path (Join-Path $Root "python_embeded\python.exe"))) {
  $Arc = Join-Path $Dl "ComfyUI_windows_portable_nvidia.7z"
  if (-not (Test-Path $Arc)) { Fetch $PortableUrl "$Arc.part"; Move-Item -Force "$Arc.part" $Arc }
  Unblock-File $Arc
  $7z = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($7z) { & $7z x $Arc "-o$Here" -y | Out-Null } else { & tar.exe -xf $Arc -C $Here } # Windows 11's tar reads .7z
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $Root "python_embeded\python.exe"))) {
    throw "Couldn't unpack the archive. Install 7-Zip (winget install 7zip.7zip) and run setup.ps1 again."
  }
  Remove-Item -Force $Arc
}
$Py = Join-Path $Root "python_embeded\python.exe"
& $Py -s -c "import torch; print('torch', torch.__version__, '| CUDA', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no GPU')"
if ($LASTEXITCODE -ne 0) { Warn "PyTorch check failed: ComfyUI may still start on the CPU. Update the NVIDIA driver if it says CUDA False." }

if ($Model -eq "nitrofusion2") {
  Step "Model: NitroFusion2 W4A8 GPTQ, encoder and VAE (about 12 GB total)"
  # NitroFusion2's upstream README links this Apache-2.0 conversion for stock ComfyUI.
  $NitroRepo = "https://huggingface.co/PedroMarinhoDev/NitroFusion2-ComfyUI/resolve/fa0668b0122e78dc81a230f901b6feaca62560f4"
  $ZImageRepo = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/6fc90a3b1b653e935a0d175e260736de25b84df5/split_files"
  InstallModel "diffusion_models\nitrofusion2_w4a8_gptq.safetensors" "$NitroRepo/diffusion_models/nitrofusion2_w4a8_gptq.safetensors" "373741d551d0dc768a02f0ef49eeeca7bf29b992b889c413e99bdac60716443b" 3488205928
  InstallModel "text_encoders\qwen_3_4b.safetensors" "$ZImageRepo/text_encoders/qwen_3_4b.safetensors" "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a" 8044982048
  InstallModel "vae\ae.safetensors" "$ZImageRepo/vae/ae.safetensors" "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38" 335304388
} else {
  Step "Model: SDXL-Lightning 4-step (6.9 GB)"
  InstallModel "checkpoints\$ModelFile" $ModelUrl $ModelSha $ModelBytes
  Copy-Item -Force (Join-Path $Here "workflow-txt2img.json") (Join-Path $Root "ComfyUI\user\orbit-workflow-txt2img.json") -ErrorAction SilentlyContinue
}

Step "Browser for CORE (browse tool)"
# ORBIT's browser uses the Chrome or Edge already on this PC (Edge is always there). Nothing to install.
if (-not ((Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"))) {
  Warn "No Chrome or Edge found: run  npx playwright install chromium  in the ORBIT folder."
}

Write-Host "`nDone. ORBIT starts ComfyUI by itself when it needs a picture." -ForegroundColor Green
if ($Model -eq "nitrofusion2") { Write-Host "Set ORBIT_COMFY_MODEL=nitrofusion2 in .env.local and restart ORBIT to select NitroFusion2." }
Write-Host "Check it in OPERATIONS -> Local AI ('Pictures (unlimited)'). To run it by hand: powershell -ExecutionPolicy Bypass -File tools\comfyui\start.ps1"
