# Starts ORBIT's desk listener + local helper in the background (the orb appears bottom-right). Log: %LOCALAPPDATA%\orbit\voice\voice.log
#   powershell -ExecutionPolicy Bypass -File tools\voice\start.ps1          (background, no window)
#   powershell -ExecutionPolicy Bypass -File tools\voice\start.ps1 -Console (this window, for debugging; Ctrl+C stops)
param([switch]$Console)
$Here = $PSScriptRoot
$Py = Join-Path $Here ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { Write-Host "Not installed yet. Run first:  powershell -ExecutionPolicy Bypass -File tools\voice\setup.ps1" -ForegroundColor Yellow; exit 1 }
$script = Join-Path $Here "orbit_voice.py"
# One at a time: stop an older copy first (only ours: matched by its command line).
Get-CimInstance Win32_Process -Filter "Name like 'python%'" | Where-Object { $_.CommandLine -like "*orbit_voice.py*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if ($Console) { & $Py $script; exit $LASTEXITCODE }
Start-Process (Join-Path $Here ".venv\Scripts\pythonw.exe") -ArgumentList "`"$script`"" -WorkingDirectory $Here -WindowStyle Hidden
Write-Host "ORBIT voice started. Turn it on in ORBIT: Voice settings → Background `"Hey Orbit`"."
