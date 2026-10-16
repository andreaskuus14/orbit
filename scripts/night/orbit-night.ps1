# ORBIT night run: started by the "ORBIT night run" Scheduled Task (which wakes the PC). Starts the ORBIT server (no
# window), keeps the PC awake while the Video Scout, downloads and clip renders run, then puts the PC back to sleep.
# Never sleeps the PC when someone used it in the last 10 minutes: then it just exits and leaves ORBIT running.
# Install: npm run night:install (scripts\night\README.md). Log: orbit-night.log in the ORBIT folder.
param(
  [int]$IdleMinutes = 10, # sleep once nothing has been busy this long...
  [int]$MinMinutes = 20,  # ...but not before this long after the start (the scout's catch-up check runs ~1 min after start)
  [int]$MaxMinutes = 240  # sleep after this long even if something is still busy
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logFile = Join-Path $root "orbit-night.log"
$busyUrl = "http://127.0.0.1:3000/api/studio/busy"

function Write-Log([string]$msg) {
  try { Add-Content -Path $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) } catch { }
  Write-Host $msg
}
try { if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) { Move-Item $logFile "$logFile.1" -Force } } catch { }

$mutex = New-Object System.Threading.Mutex($false, "Local\orbit-night")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { Write-Log "Another night run is already running; exiting."; exit 0 }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OrbitPower {
  [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 0x00000001;
  // Held until Release() or until this process exits; without it Windows re-sleeps an unattended wake after ~2 min.
  public static void KeepAwake() { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED); }
  public static void Release() { SetThreadExecutionState(ES_CONTINUOUS); }
  // Milliseconds since the last keyboard/mouse input in this session (tick count keeps running during sleep).
  public static uint IdleMs() {
    LASTINPUTINFO li = new LASTINPUTINFO();
    li.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref li)) return 0; // unknown: treat as active, never sleep
    return unchecked((uint)Environment.TickCount - li.dwTime);
  }
}
"@

$start = Get-Date
[OrbitPower]::KeepAwake()
Write-Log ("Night run started (user idle {0:N0} min). Starting ORBIT if needed." -f ([OrbitPower]::IdleMs() / 60000))

# Same as the wake listener: the launcher returns quickly when the server is up, otherwise starts it under the supervisor.
try {
  $launcher = Join-Path $root "scripts\launch.ps1"
  $p = Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ServerOnly" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $null = $p.Handle; $p.WaitForExit() # not -Wait: in PowerShell 5.1 that also waits for the supervisor it leaves running
  if ($p.ExitCode -ne 0) { Write-Log "ERROR: ORBIT didn't start (exit $($p.ExitCode)). See orbit-server.log / orbit-launcher.log." }
  else { Write-Log "ORBIT is running." }
} catch { Write-Log "ERROR starting ORBIT: $($_.Exception.Message)" }

# Poll every minute. Unreachable / error counts as not busy, so a dead server can't keep the PC up all night.
$lastBusy = $start
$lastState = ""
$reason = ""
while ($true) {
  Start-Sleep -Seconds 60
  $state = "unreachable"
  try {
    $r = Invoke-RestMethod $busyUrl -TimeoutSec 15
    if ($r.busy) {
      $lastBusy = Get-Date
      $state = "busy:" + ((@("clips", "downloads", "scout", "publishing", "scoutPending") | Where-Object { $r.$_ }) -join ",")
    } else { $state = "idle" }
  } catch { }
  if ($state -ne $lastState) { Write-Log "ORBIT: $state"; $lastState = $state }
  $now = Get-Date
  if (($now - $start).TotalMinutes -ge $MaxMinutes) { $reason = "time limit ($MaxMinutes min) reached"; break }
  if (($now - $start).TotalMinutes -ge $MinMinutes -and ($now - $lastBusy).TotalMinutes -ge $IdleMinutes) { $reason = "nothing busy for $IdleMinutes min"; break }
}

[OrbitPower]::Release()
$idleMin = [OrbitPower]::IdleMs() / 60000
if ($idleMin -lt 10) {
  Write-Log ("Done ({0}), but the PC was used {1:N0} min ago: not sleeping; ORBIT keeps running." -f $reason, $idleMin)
  exit 0
}
Write-Log ("Done ({0}); putting the PC to sleep. Ran {1:N0} min." -f $reason, ((Get-Date) - $start).TotalMinutes)
try {
  Add-Type -AssemblyName System.Windows.Forms
  # Suspend, not hibernate (rundll32 powrprof SetSuspendState hibernates when hibernation is on). force=false: apps may veto.
  if (-not [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)) {
    Write-Log "Windows refused to sleep (an app or policy blocked it)."
  }
} catch { Write-Log "ERROR going to sleep: $($_.Exception.Message)" }
