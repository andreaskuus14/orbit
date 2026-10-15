# Stops ORBIT: first the supervisor (so nothing restarts the server), then every ORBIT server process,
# however it was started (launcher, wake listener, or "npm run dev" in a terminal).
$root = Split-Path -Parent $PSScriptRoot
$stopped = 0

# The hidden supervisor started by launch.ps1 -Supervise. /T also ends its cmd -> npm -> next children.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*launch.ps1*-Supervise*' } |
  ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null; $stopped++ }

# Any Next.js process running from this folder (node ...\orbit\node_modules\...\next\dist\...).
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '\\next\\dist\\' } |
  ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F 2>&1 | Out-Null; $stopped++ }

# Last resort: whatever node process still listens on port 3000.
Start-Sleep -Seconds 1
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($owner -and $owner.ProcessName -eq "node") { Stop-Process -Id $owner.Id -Force; $stopped++ }
  elseif ($owner) { Write-Host "Port 3000 is used by '$($owner.ProcessName)' (PID $($owner.Id)), not ORBIT; left it running." }
}

if ($stopped -gt 0) { Write-Host "ORBIT stopped." } else { Write-Host "ORBIT isn't running." }
