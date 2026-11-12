# Trial 2 (Moonshine voice). One command:  .\voice-trial.ps1
# Creates tools\trials\.venv (git-ignored), installs Moonshine into it only, then runs voice-trial.mjs.
# Needs: Python 3.10+, Node 22+, ORBIT running, $env:ORBIT_COOKIE set (see README), clips recorded in clips\en and clips\et.
$ErrorActionPreference = "Stop"; Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -c "import moonshine_onnx" 2>$null
if ($LASTEXITCODE -ne 0) { & $py -m pip install --quiet useful-moonshine-onnx }
node voice-trial.mjs @args
