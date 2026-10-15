# ORBIT launcher: makes sure the ORBIT server runs, then opens ORBIT in its own app window.
# The server is a production build ("npm run start", rebuilt automatically when src/ changed) watched by a hidden
# supervisor that restarts it if it crashes. It keeps running after you close the window, so scheduled briefings
# still happen. Stop it with scripts\stop.ps1 (npm run app:stop).
#   -ServerOnly  only make sure the server runs: no window, no pop-ups (Windows sign-in auto-start, wake listener)
#   -Dev         run the development server ("npm run dev": hot reload, slower) instead of a production build
#   -Rebuild     stop ORBIT, force a fresh "npm run build", then start again
#   -Supervise   internal: the hidden supervisor loop started by this script
param([switch]$ServerOnly, [switch]$Dev, [switch]$Rebuild, [switch]$Supervise)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000"
$healthUrl = "http://127.0.0.1:3000/api/health" # the server listens on 127.0.0.1 only (see package.json)
$log = Join-Path $root "orbit-server.log"
$buildId = Join-Path $root ".next\BUILD_ID"

function Write-Log([string]$msg) {
  try { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  [orbit] {1}" -f (Get-Date), $msg) } catch { }
  Write-Host $msg
}

# True when there is no production build or something it was built from changed since.
function Test-BuildStale {
  if (-not (Test-Path $buildId)) { return $true }
  $built = (Get-Item $buildId).LastWriteTimeUtc
  $inputs = @(Get-ChildItem (Join-Path $root "src") -Recurse -File -ErrorAction SilentlyContinue)
  # NEXT_PUBLIC_* values in .env files are baked into the build, so they count too.
  $inputs += @(Get-ChildItem $root -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(package\.json|package-lock\.json|next\.config\.\w+|\.env.*)$' })
  return [bool]($inputs | Where-Object { $_.LastWriteTimeUtc -gt $built } | Select-Object -First 1)
}

function Get-Health {
  try { Invoke-RestMethod $healthUrl -TimeoutSec 3 } catch { $null }
}

# ---- Supervisor: build if needed, run the server, restart it when it exits unexpectedly. ----
if ($Supervise) {
  $mutex = New-Object System.Threading.Mutex($false, "Local\orbit-supervisor")
  try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) { exit 0 } # one supervisor at a time
  $devMode = $Dev.IsPresent
  $crashes = @()
  $rebuilt = $false
  while ($true) {
    try { if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item $log "$log.1" -Force } } catch { }
    if (-not $devMode -and (Test-BuildStale)) {
      Write-Log "Building ORBIT (npm run build)..."
      $b = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run build >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
      $null = $b.Handle; $b.WaitForExit() # not -Wait: in PowerShell 5.1 that waits for every descendant process too
      if ($b.ExitCode -ne 0) {
        Write-Log "BUILD FAILED (exit $($b.ExitCode)). Running in DEVELOPMENT mode instead. Fix the errors above, then run: npm run app:rebuild"
        $devMode = $true
      } else { Write-Log "Build finished." }
    }
    $npmScript = if ($devMode) { "dev" } else { "start" }
    Write-Log "Starting ORBIT server (npm run $npmScript) on port 3000."
    $started = Get-Date
    $p = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run $npmScript >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $null = $p.Handle # Windows PowerShell 5.1: keeps ExitCode readable after the process exits
    $p.WaitForExit()
    # stop.ps1 kills this supervisor first, so reaching here always means an unexpected exit.
    $ran = ((Get-Date) - $started).TotalSeconds
    Write-Log ("ORBIT server exited unexpectedly (code {0}) after {1:N0} s." -f $p.ExitCode, $ran)
    if (-not $devMode -and $ran -lt 60 -and -not $rebuilt) {
      # A production server dying at boot usually means .next was overwritten (e.g. by "npm run dev"): rebuild once.
      Remove-Item $buildId -Force -ErrorAction SilentlyContinue
      $rebuilt = $true
    }
    $now = Get-Date
    $crashes = @($crashes | Where-Object { ($now - $_).TotalMinutes -lt 10 }) + $now
    if ($crashes.Count -gt 5) { Write-Log "GAVE UP: the server stopped $($crashes.Count) times in 10 minutes. See the errors above, then start ORBIT again."; exit 1 }
    $wait = [int][Math]::Min(60, [Math]::Pow(2, $crashes.Count))
    Write-Log "Restarting in $wait s."
    Start-Sleep -Seconds $wait
  }
}

# ---- Launcher ----
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Rebuild) {
  & (Join-Path $PSScriptRoot "stop.ps1")
  Remove-Item $buildId -Force -ErrorAction SilentlyContinue
}

$health = Get-Health
if ($health -and $health.mode -eq "production" -and -not $Dev) {
  # A running server keeps serving its old build after an update or a manual "npm run build" (which also breaks it).
  $diskId = "$(Get-Content $buildId -Raw -ErrorAction SilentlyContinue)".Trim()
  if ((Test-BuildStale) -or ($health.buildId -and $diskId -ne $health.buildId)) {
    Write-Log "ORBIT changed since the server started; restarting it on a fresh build."
    & (Join-Path $PSScriptRoot "stop.ps1")
    $health = $null
  }
}
if (-not $health) {
  $stale = (-not $Dev) -and (Test-BuildStale)
  # Port check, not HTTP: a server busy compiling can miss the timeout, and a second one would land on 3001.
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    $supArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Supervise"
    if ($Dev) { $supArgs += " -Dev" }
    Start-Process powershell.exe -ArgumentList $supArgs -WorkingDirectory $root -WindowStyle Hidden
  }
  $limit = if ($stale) { 600 } else { 120 }
  $tray = $null
  if ($stale) {
    Write-Host "Building ORBIT after an update; this takes a minute or two. Progress: $log"
    if (-not $ServerOnly) {
      try {
        $tray = New-Object System.Windows.Forms.NotifyIcon
        $tray.Icon = [System.Drawing.SystemIcons]::Information
        $tray.Visible = $true
        $tray.ShowBalloonTip(15000, "ORBIT", "Building ORBIT after an update. This takes a minute or two.", [System.Windows.Forms.ToolTipIcon]::Info)
      } catch { }
    }
  }
  $deadline = (Get-Date).AddSeconds($limit)
  $last = ""
  while (-not ($health = Get-Health)) {
    if ((Get-Date) -gt $deadline) {
      if ($tray) { $tray.Dispose() }
      Write-Log "ORBIT didn't answer within $limit s."
      if (-not $ServerOnly) {
        [System.Windows.Forms.MessageBox]::Show("ORBIT didn't start within $([int]($limit / 60)) minutes. See orbit-server.log in $root.`n`nIf an old ORBIT is stuck, run: npm run app:stop", "ORBIT") | Out-Null
      }
      exit 1
    }
    try { $line = Get-Content $log -Tail 1 -ErrorAction Stop; if ($line -and $line -ne $last) { Write-Host "  $line"; $last = $line } } catch { }
    Start-Sleep -Seconds 2
  }
  if ($tray) { $tray.Dispose() }
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

if ($health.mode -eq "development" -and -not $Dev) {
  [System.Windows.Forms.MessageBox]::Show("ORBIT is running in development mode (slower), because the production build failed or a dev server was already running.`n`nSee orbit-server.log in $root. After fixing it, run: npm run app:rebuild", "ORBIT") | Out-Null
}
