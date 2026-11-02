# ORBIT local brain: installs Ollama (if missing), pulls a small model, prints a test reply and sets ORBIT_LOCAL_LLM_MODEL in .env.local.
# Run from the ORBIT folder:  powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1
#   -Model qwen3:8b   the model to pull (default; ~5.2 GB, fits an 8 GB GPU)
#   -Private          also set ORBIT_LOCAL_PRIVATE=1: lets the local model (only it, never Claude) read your journal when you click Reflect
# No admin rights needed: Ollama installs into your user folder.
param([string]$Model = "qwen3:8b", [switch]$Private)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$api = "http://127.0.0.1:11434"

function Find-Ollama {
  $c = Get-Command ollama -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe" # default install place; PATH isn't refreshed in this window yet
  if (Test-Path $p) { return $p }
  return $null
}

# 1. Install
$ollama = Find-Ollama
if (-not $ollama) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget isn't available. Download and run the installer from https://ollama.com/download, then run this script again." -ForegroundColor Red
    exit 1
  }
  Write-Host "Installing Ollama (winget install --id Ollama.Ollama)..."
  winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  $ollama = Find-Ollama
  if (-not $ollama) { Write-Host "Ollama didn't install. Get it from https://ollama.com/download and run this script again." -ForegroundColor Red; exit 1 }
}
Write-Host "Ollama: $ollama"

# 2. Make sure it runs (the installer normally starts it in the tray)
function Test-Api { try { $null = Invoke-RestMethod "$api/api/tags" -TimeoutSec 3; $true } catch { $false } }
if (-not (Test-Api)) {
  Write-Host "Starting Ollama (ollama serve, hidden)..."
  Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Test-Api); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Api)) { Write-Host "Ollama isn't answering at $api. Start Ollama from the Start menu and run this script again." -ForegroundColor Red; exit 1 }
}

# 3. Pull the model (resumes if interrupted)
Write-Host "Pulling $Model (a few GB the first time)..."
& $ollama pull $Model
if ($LASTEXITCODE -ne 0) { Write-Host "ollama pull $Model failed." -ForegroundColor Red; exit 1 }

# 4. Test reply
$body = @{ model = $Model; stream = $false; messages = @(@{ role = "user"; content = "Say hello in one short English sentence, then the same in Estonian." }) }
if ($Model -like "qwen3*") { $body.think = $false }
Write-Host "Asking $Model for a test reply (the first load into the GPU takes a few seconds)..."
$r = Invoke-RestMethod "$api/api/chat" -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json -Depth 5) -TimeoutSec 300
Write-Host ""
Write-Host $r.message.content -ForegroundColor Cyan
Write-Host ""

# 5. .env.local (UTF-8 without BOM, other lines kept)
function Set-EnvLine([string]$name, [string]$value) {
  $file = Join-Path $root ".env.local"
  $lines = @(if (Test-Path $file) { Get-Content -LiteralPath $file } else { @() })
  $lines = @($lines | Where-Object { $_ -notmatch "^\s*$name\s*=" }) + "$name=$value"
  [IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Set $name=$value in .env.local"
}
Set-EnvLine "ORBIT_LOCAL_LLM_MODEL" $Model
if ($Private) { Set-EnvLine "ORBIT_LOCAL_PRIVATE" "1" }

Write-Host ""
Write-Host "Done. Restart ORBIT so it reads the new setting:  npm run app:rebuild" -ForegroundColor Green
Write-Host "Then OPERATIONS -> Local AI shows 'Local brain: Ready'."
