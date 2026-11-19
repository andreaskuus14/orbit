# Starts the TRELLIS.2 ComfyUI by hand (ORBIT normally starts it by itself). Only reachable from this PC.
$Here = $PSScriptRoot
Set-Location (Join-Path $Here "ComfyUI")
& (Join-Path $Here "env\Scripts\python.exe") -s main.py --listen 127.0.0.1 --port 8189 --disable-auto-launch --lowvram
