# ORBIT desk listener ("Hey Orbit" in any window) + local PC helper: one-time setup on Windows. From the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\voice\setup.ps1              (venv + Silero VAD, ~60 MB; starts at sign-in)
#   powershell -ExecutionPolicy Bypass -File tools\voice\setup.ps1 -NoAutostart (no Startup shortcut; run start.ps1 yourself)
# Needs Python 3.11 (winget install Python.Python.3.11). Installs into tools\voice\.venv and tools\voice\models (git-ignored).
# Then turn it on in ORBIT: Voice settings → Background "Hey Orbit". ORBIT_WAKE=0 in .env.local keeps it off.
# Speech recognition is ORBIT's own Parakeet (already set up for voice); nothing new is downloaded for it here.
param([switch]$NoAutostart)
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Venv = Join-Path $Here ".venv"
$Py = Join-Path $Venv "Scripts\python.exe"
$Models = Join-Path $Here "models"
# Silero VAD v5.1.2 (MIT): the ONNX model from the PyPI wheel (installed --no-deps: no torch), pinned by hash.
$VadPkg = "silero-vad==5.1.2"
$VadSha = "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f"

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') failed ($LASTEXITCODE)" } }

Step "Python venv"
if (-not (Test-Path $Py)) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) { Run "py" @("-3.11", "-m", "venv", $Venv) } else { Run "python" @("-m", "venv", $Venv) }
}
Run $Py @("-m", "pip", "install", "--upgrade", "pip", "--quiet")
Run $Py @("-m", "pip", "install", "-r", (Join-Path $Here "requirements.txt"), "--quiet")

Step "Silero VAD model"
New-Item -ItemType Directory -Force -Path $Models | Out-Null
$onnx = Join-Path $Models "silero_vad.onnx"
if (-not (Test-Path $onnx) -or (Get-FileHash $onnx -Algorithm SHA256).Hash.ToLower() -ne $VadSha) {
  $tmp = Join-Path $env:TEMP "orbit-silero"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Run $Py @("-m", "pip", "download", $VadPkg, "--no-deps", "--dest", $tmp, "--quiet")
  $whl = Get-ChildItem $tmp -Filter "silero_vad-*.whl" | Select-Object -First 1
  Run $Py @("-I", "-c", "import sys,zipfile; open(sys.argv[2],'wb').write(zipfile.ZipFile(sys.argv[1]).read('silero_vad/data/silero_vad.onnx'))", $whl.FullName, $onnx)
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  $got = (Get-FileHash $onnx -Algorithm SHA256).Hash.ToLower()
  if ($got -ne $VadSha) { Remove-Item $onnx; throw "silero_vad.onnx hash mismatch ($got)" }
}

Step "Self-test"
Run $Py @("-m", "unittest", "discover", "-s", (Join-Path $Here "tests"))

if (-not $NoAutostart) {
  Step "Start at sign-in"
  $lnkPath = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT voice.lnk"
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath)
  $lnk.TargetPath = Join-Path $Venv "Scripts\pythonw.exe"
  $lnk.Arguments = "`"$(Join-Path $Here 'orbit_voice.py')`""
  $lnk.WorkingDirectory = $Here
  $lnk.Description = "ORBIT desk listener (Hey Orbit) + local helper"
  $lnk.Save()
  Write-Host "Startup shortcut: $lnkPath (remove it to stop starting at sign-in)"
}
Write-Host "`nDone. Start now: powershell -ExecutionPolicy Bypass -File tools\voice\start.ps1" -ForegroundColor Green
Write-Host "Then in ORBIT: Voice settings → Background `"Hey Orbit`". Optional in .env.local: ORBIT_PC_FOLDERS=C:\Users\you\Games;D:\Renders"
