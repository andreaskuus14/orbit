# ORBIT launcher: starts the ORBIT server if it isn't running, then opens ORBIT in its own app window.
# The server keeps running after you close the window, so scheduled briefings still happen.
# -ServerOnly: just make sure the server runs (used by the Windows sign-in auto-start).
param([switch]$ServerOnly)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000"
Add-Type -AssemblyName System.Windows.Forms

function Test-Orbit {
  try { (Invoke-WebRequest "$url/login" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Orbit)) {
  $log = Join-Path $root "orbit-server.log"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev > `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Test-Orbit)) {
    if ((Get-Date) -gt $deadline) {
      [System.Windows.Forms.MessageBox]::Show("ORBIT didn't start within 2 minutes. See orbit-server.log in $root.", "ORBIT") | Out-Null
      exit 1
    }
    Start-Sleep -Seconds 1
  }
}

if ($ServerOnly) { exit 0 }

# Chrome first (where you're signed in to ORBIT), then Edge. --app gives a clean window with no tabs or address bar.
$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) { Start-Process $browser "--app=$url --window-size=1440,900" } else { Start-Process $url }
