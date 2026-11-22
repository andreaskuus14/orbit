# One-time setup for CORE's code sandbox (src/lib/sandbox.ts): its own Python venv with numpy, pandas, matplotlib and openpyxl.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox\setup.ps1
# Everything goes into tools\sandbox\.venv only (nothing global). Safe to run again. No restart needed: ORBIT finds the venv on the next run.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$base = Get-Command py -ErrorAction SilentlyContinue
$mk = if ($base) { { py -3 -m venv .venv } } elseif (Get-Command python -ErrorAction SilentlyContinue) { { python -m venv .venv } } else { $null }
if (-not $mk) { Write-Host "Python 3.10+ is needed for the code sandbox: install it from python.org (tick 'Add to PATH'), then run this again."; exit 1 }
if (-not (Test-Path .venv)) { & $mk }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
function Test-Py([string]$code) { cmd /c "`"$py`" -c `"$code`" >nul 2>nul"; return ($LASTEXITCODE -eq 0) }
if (-not (Test-Py "import numpy, pandas, matplotlib, openpyxl")) {
  # no pip self-upgrade: on Windows it often hits "file in use" (WinError 32)
  cmd /c "`"$py`" -m pip install --quiet --disable-pip-version-check -r requirements.txt"
  if ($LASTEXITCODE -ne 0) { Write-Host "Installing the packages failed. Close ORBIT (and any Python window), then run this again." -ForegroundColor Yellow; exit 1 }
}
# A short self-test inside the sandbox harness: a chart is made and the network is refused.
$tmp = Join-Path $env:TEMP ("orbit-sandbox-setup-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
Set-Content -Path (Join-Path $tmp "main.py") -Encoding UTF8 -Value @"
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9]); plt.savefig('check.png')
try:
    import socket; socket.create_connection(('example.com', 80)); print('NETWORK OPEN')
except PermissionError:
    print('network blocked')
"@
Set-Content -Path (Join-Path $tmp "limits.json") -Value '{"memoryMb":1024,"cpuSec":60,"wallSec":60}'
Push-Location $tmp
# through cmd: PowerShell 5.1 turns any stderr line into a fatal error under "Stop"
$out = cmd /c "`"$py`" -I `"$(Join-Path $PSScriptRoot 'run.py')`" `"$(Join-Path $tmp 'limits.json')`" 2>&1"
Pop-Location
$ok = (Test-Path (Join-Path $tmp "check.png")) -and ("$out" -match "network blocked")
Remove-Item -Recurse -Force $tmp
if ($ok) { Write-Host "Code sandbox ready." } else { Write-Host "The sandbox self-test didn't pass:`n$out" -ForegroundColor Yellow; exit 1 }
