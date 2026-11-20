# ORBIT local pictures: one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1
# Installs the official ComfyUI Windows portable build (its own embedded Python + PyTorch CUDA 13.0, so tools\local-ai\.venv and
# its torch are never touched) into tools\comfyui\ComfyUI_windows_portable, and the selected image model.
# Downloads are pinned and SHA-256 checked. Finished parts are skipped, a cut-off model download resumes.
# ORBIT then starts ComfyUI by itself on 127.0.0.1:8188 when it needs a picture (start.ps1 runs it by hand).
# UNTESTED on Windows/GPU: written in a cloud box. Needs an NVIDIA driver 580 or newer (CUDA 13.0); the RTX 5060 Laptop is fine.
param([ValidateSet("sdxl-lightning", "nitrofusion2", "acestep-music", "wan22-video")][string]$Model = "sdxl-lightning")

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
# Local video (-Model wan22-video): city96's ComfyUI-GGUF node pack (Apache-2.0) + Wan 2.2 TI2V-5B Q6_K GGUF.
$GgufRepo = "https://github.com/city96/ComfyUI-GGUF.git"; $GgufRev = "6ea2651e7df66d7585f6ffee804b20e92fb38b8a"

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

function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "Failed ($LASTEXITCODE): $exe $($a -join ' ')" } }
function Pin($dir, $repo, $rev) {
  if (-not (Test-Path (Join-Path $dir ".git"))) { Run git @("clone", "--filter=blob:none", $repo, $dir) }
  Run git @("-C", $dir, "fetch", "--depth", "1", "origin", $rev)
  Run git @("-C", $dir, "checkout", "--force", $rev)
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

if ($Model -eq "acestep-music") {
  # ===== BEGIN acestep-music (self-contained block; keep separate from the other -Model branches) =====
  Step "Model: ACE-Step 1.5 turbo music (about 10 GB: DiT, two text encoders, VAE)"
  # ACE-Step 1.5 (MIT; the model card allows commercial use of the output), ComfyUI's repackaged split files, pinned revision.
  $AceRepo = "https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/split_files"
  InstallModel "diffusion_models\acestep_v1.5_turbo.safetensors" "$AceRepo/diffusion_models/acestep_v1.5_turbo.safetensors" "3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7" 4787825604
  InstallModel "text_encoders\qwen_0.6b_ace15.safetensors" "$AceRepo/text_encoders/qwen_0.6b_ace15.safetensors" "fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7" 1191588248
  InstallModel "text_encoders\qwen_1.7b_ace15.safetensors" "$AceRepo/text_encoders/qwen_1.7b_ace15.safetensors" "ed63e9247d1f55f3ace04fa11e95b085fc82d459c82c5626f0b2e37b91ebd710" 3708523360
  InstallModel "vae\ace_1.5_vae.safetensors" "$AceRepo/vae/ace_1.5_vae.safetensors" "6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb" 337431732
  # ===== END acestep-music =====
} elseif ($Model -eq "nitrofusion2") {
  Step "Model: NitroFusion2 W4A8 GPTQ, encoder and VAE (about 12 GB total)"
  # NitroFusion2's upstream README links this Apache-2.0 conversion for stock ComfyUI.
  $NitroRepo = "https://huggingface.co/PedroMarinhoDev/NitroFusion2-ComfyUI/resolve/fa0668b0122e78dc81a230f901b6feaca62560f4"
  $ZImageRepo = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/6fc90a3b1b653e935a0d175e260736de25b84df5/split_files"
  InstallModel "diffusion_models\nitrofusion2_w4a8_gptq.safetensors" "$NitroRepo/diffusion_models/nitrofusion2_w4a8_gptq.safetensors" "373741d551d0dc768a02f0ef49eeeca7bf29b992b889c413e99bdac60716443b" 3488205928
  InstallModel "text_encoders\qwen_3_4b.safetensors" "$ZImageRepo/text_encoders/qwen_3_4b.safetensors" "6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a" 8044982048
  InstallModel "vae\ae.safetensors" "$ZImageRepo/vae/ae.safetensors" "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38" 335304388
} elseif ($Model -eq "wan22-video") {
  Step "Local video: ComfyUI-GGUF node pack (pinned)"
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is missing: winget install Git.Git, then run setup.ps1 again." }
  $GgufDir = Join-Path $Root "ComfyUI\custom_nodes\ComfyUI-GGUF"
  Pin $GgufDir $GgufRepo $GgufRev
  Run $Py @("-s", "-m", "pip", "install", "-r", (Join-Path $GgufDir "requirements.txt")) # the gguf package (pure Python)
  Step "Model: Wan 2.2 TI2V-5B Q6_K, umt5 encoder, VAE and FastWan speed LoRA (about 10.5 GB total, all Apache-2.0)"
  $WanRepo = "https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF/resolve/57437632ddd08bdcbd1508c866aa22e126ed51d2"
  $UmtRepo = "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/b535255bee98c2b0a59ea7c0ae2dcd0c6657b3b7"
  $VaeRepo = "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/5df3a4a3ed0628002308022198249dbbbd045d09"
  $LoraRepo = "https://huggingface.co/Kijai/WanVideo_comfy/resolve/8260d429d19fd7a72304cad059160b95d843913f"
  InstallModel "unet\Wan2.2-TI2V-5B-Q6_K.gguf" "$WanRepo/Wan2.2-TI2V-5B-Q6_K.gguf" "355f6bee35c4c6cbd0f275112619fe8ac6f7b9b067b885723667b3bde29497c3" 4211683680
  InstallModel "text_encoders\umt5-xxl-encoder-Q5_K_M.gguf" "$UmtRepo/umt5-xxl-encoder-Q5_K_M.gguf" "eaea358bb438c5d211721a4feecc162000e3636e9cb96f51e216f1f44ebd12ce" 4145878880
  InstallModel "vae\wan2.2_vae.safetensors" "$VaeRepo/split_files/vae/wan2.2_vae.safetensors" "e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156" 1409400960
  InstallModel "loras\Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors" "$LoraRepo/FastWan/Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors" "79290493711b022e1c6e655d803715cd8a91a75cdb139856cad46f354e2f681c" 660874456
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

Write-Host "`nDone. ORBIT starts ComfyUI by itself when it needs a picture, a music bed or a video." -ForegroundColor Green
if ($Model -eq "acestep-music") { Write-Host "Music is on by itself once these files exist (ORBIT_MUSIC_GEN=off turns it off). Needs a ComfyUI recent enough to have the ACE-Step 1.5 nodes: the portable build you just installed is." }
if ($Model -eq "wan22-video") { Write-Host "Local video is ready: ask CORE for a local_video clip. Not benchmarked yet: the first clip loads about 10 GB and may take several minutes." }
if ($Model -eq "nitrofusion2") { Write-Host "Set ORBIT_COMFY_MODEL=nitrofusion2 in .env.local and restart ORBIT to select NitroFusion2." }
Write-Host "Check it in OPERATIONS -> Local AI ('Pictures (unlimited)'). To run it by hand: powershell -ExecutionPolicy Bypass -File tools\comfyui\start.ps1"
