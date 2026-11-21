# ORBIT Kaggle burst: installs the official Kaggle CLI (pip "kaggle" 2.2.5, Apache-2.0) into tools\kaggle\.venv, checks your token,
# shows your weekly GPU hours and sets ORBIT_KAGGLE_CLI in .env.local. Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\kaggle\setup.ps1
# The token stays where Kaggle's CLI keeps it: %USERPROFILE%\.kaggle\kaggle.json (or access_token). Never copy it into the ORBIT folder.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$venv = Join-Path $PSScriptRoot ".venv"
$kaggle = Join-Path $venv "Scripts\kaggle.exe"

# 1. Python 3.11+ (the Kaggle CLI needs it) and the pinned CLI in its own venv
if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Write-Host "Python isn't installed. Install Python 3.11+ from python.org (tick 'py launcher'), then run this again." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) { & py -3 -m venv $venv; if ($LASTEXITCODE) { Write-Host "Couldn't make the venv (needs Python 3.11+)." -ForegroundColor Red; exit 1 } }
& (Join-Path $venv "Scripts\python.exe") -m pip install -q --disable-pip-version-check "kaggle==2.2.5"
if ($LASTEXITCODE -or -not (Test-Path $kaggle)) { Write-Host "The Kaggle CLI didn't install." -ForegroundColor Red; exit 1 }
Write-Host "Kaggle CLI: $kaggle"

# 2. The token (only checked for, never read)
$dir = if ($env:KAGGLE_CONFIG_DIR) { $env:KAGGLE_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".kaggle" }
if (-not (Test-Path (Join-Path $dir "kaggle.json")) -and -not (Test-Path (Join-Path $dir "access_token"))) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host ""
  Write-Host "No Kaggle token yet. In the page that opens: Settings -> API -> 'Create Legacy API Key' downloads kaggle.json." -ForegroundColor Yellow
  Write-Host "Move that file to: $dir\kaggle.json   then run this script again."
  Start-Process "https://www.kaggle.com/settings/api"
  exit 1
}

# 3. Proof it works: your weekly GPU quota, straight from Kaggle
& $kaggle quota
if ($LASTEXITCODE) { Write-Host "Kaggle didn't accept the token. Make a new one at kaggle.com/settings/api." -ForegroundColor Red; exit 1 }
Write-Host "Scripts may use a GPU and the internet only after your phone number is verified on kaggle.com (Settings -> Phone verification)." -ForegroundColor Yellow

# 4. .env.local (UTF-8 without BOM, other lines kept)
function Set-EnvLine([string]$name, [string]$value) {
  $file = Join-Path $root ".env.local"
  $lines = @(if (Test-Path $file) { Get-Content -LiteralPath $file } else { @() })
  $lines = @($lines | Where-Object { $_ -notmatch "^\s*$name\s*=" }) + "$name=$value"
  [IO.File]::WriteAllLines($file, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Set $name=$value in .env.local"
}
Set-EnvLine "ORBIT_KAGGLE_CLI" $kaggle
if (-not (Test-Path (Join-Path $dir "kaggle.json"))) { Write-Host "You use access_token (no username inside): also add ORBIT_KAGGLE_USER=<your Kaggle username> to .env.local." -ForegroundColor Yellow }
Write-Host ""
Write-Host "Done. Restart ORBIT (npm run app:rebuild); OPERATIONS -> Local AI -> Kaggle burst then shows your hours." -ForegroundColor Green
