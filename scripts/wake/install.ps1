# Installs the ORBIT wake listener: a shortcut in your Startup folder (runs hidden at every sign-in), and starts it now.
# No admin rights; touches nothing else.
$script = Join-Path $PSScriptRoot "orbit-wake.ps1"
$dataDir = Join-Path $env:LOCALAPPDATA "orbit-wake"
$pidFile = Join-Path $dataDir "pid"
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
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

$lnkPath = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT wake.lnk"
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = $arguments
$lnk.WorkingDirectory = $PSScriptRoot
$ico = Join-Path $PSScriptRoot "..\..\public\orbit.ico"
if (Test-Path $ico) { $lnk.IconLocation = "$((Resolve-Path $ico).Path),0" }
$lnk.Description = "ORBIT wake listener (say 'orbital wake up')"
$lnk.WindowStyle = 7 # minimized: no console flash
$lnk.Save()
Write-Host "Created startup shortcut: $lnkPath"

# Restart a listener that's already running so it picks up the current script.
if (Stop-Listener) { Start-Sleep -Milliseconds 500 }

$p = Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
$null = $p.Handle # keep a handle open, or ExitCode reads as empty after the process exits
Start-Sleep -Seconds 3
if ($p.HasExited -and $p.ExitCode -eq 0) {
  Write-Host "A listener is already running (it couldn't be stopped, so the new one stepped aside). Log: $(Join-Path $dataDir 'wake.log')"
  exit 0
}
if ($p.HasExited) {
  Write-Host "The listener exited right away (exit code $($p.ExitCode)). Last log lines:" -ForegroundColor Yellow
  Get-Content (Join-Path $dataDir "wake.log") -Tail 5 -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "Listener running (pid $($p.Id)). Say 'orbital wake up'. Log: $(Join-Path $dataDir 'wake.log')"
