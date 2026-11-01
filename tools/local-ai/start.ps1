# Starts ORBIT's local AI service on http://127.0.0.1:7861 (this PC only). Leave the window open; Ctrl+C stops it.
#   powershell -ExecutionPolicy Bypass -File tools\local-ai\start.ps1
$Here = $PSScriptRoot
$Py = Join-Path $Here ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { Write-Host "Not installed yet. Run first:  powershell -ExecutionPolicy Bypass -File tools\local-ai\setup.ps1" -ForegroundColor Yellow; exit 1 }
if ($env:ORBIT_LOCAL_AI_URL -match ':(\d+)') { $env:ORBIT_LOCAL_AI_PORT = $Matches[1] }
& $Py (Join-Path $Here "server.py")
