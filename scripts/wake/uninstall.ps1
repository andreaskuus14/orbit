# Removes the ORBIT wake listener: deletes the Startup shortcut and stops the running listener.
$lnkPath = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT wake.lnk"
if (Test-Path $lnkPath) { Remove-Item $lnkPath; Write-Host "Removed startup shortcut: $lnkPath" } else { Write-Host "No startup shortcut found." }

$pidFile = Join-Path $env:LOCALAPPDATA "orbit-wake\pid"
function Stop-Listener {
  # Only stop the process if it really is the listener: a reused PID could belong to any PowerShell.
  if (-not (Test-Path $pidFile)) { return $false }
  $id = [int](Get-Content $pidFile -Raw)
  $c = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if (-not ($c -and $c.CommandLine -like '*orbit-wake.ps1*')) { return $false }
  Stop-Process -Id $id -Force
  Write-Host "Stopped the listener (pid $id)."
  return $true
}
if (-not (Stop-Listener)) { Write-Host "The listener isn't running." }
Remove-Item $pidFile -ErrorAction SilentlyContinue
Write-Host "Done. (The log stays in $(Join-Path $env:LOCALAPPDATA 'orbit-wake'); delete that folder if you like.)"
