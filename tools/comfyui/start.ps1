# Starts ComfyUI for ORBIT on http://127.0.0.1:8188 (this PC only). Leave the window open; Ctrl+C stops it.
# ORBIT normally starts it by itself; this is for checking it by hand (open http://127.0.0.1:8188 in a browser).
#   powershell -ExecutionPolicy Bypass -File tools\comfyui\start.ps1
$Root = Join-Path $PSScriptRoot "ComfyUI_windows_portable"
$Py = Join-Path $Root "python_embeded\python.exe"
if (-not (Test-Path $Py)) { Write-Host "Not installed yet. Run first:  powershell -ExecutionPolicy Bypass -File tools\comfyui\setup.ps1" -ForegroundColor Yellow; exit 1 }
$Port = "8188"; if ($env:ORBIT_COMFY_URL -match ':(\d+)') { $Port = $Matches[1] }
Set-Location $Root
& $Py -s (Join-Path $Root "ComfyUI\main.py") --listen 127.0.0.1 --port $Port --disable-auto-launch
