# ORBIT launcher: makes sure the ORBIT server runs, then opens ORBIT in its own app window.
# The server is a production build ("npm run start", rebuilt automatically when src/ changed) watched by a hidden
# supervisor that restarts it if it crashes. It keeps running after you close the window, so scheduled briefings
# still happen. Stop it with scripts\stop.ps1 (npm run app:stop).
# Releases: builds go into .next-build while the current version keeps running; only a successful build is swapped
# into .next (the one before is kept as .next-prev). A failed build never replaces a working release.
#   -ServerOnly  only make sure the server runs: no window, no pop-ups (Windows sign-in auto-start, wake listener)
#   -Dev         run the development server ("npm run dev": hot reload, slower) instead of a production build
#   -Rebuild     force a fresh build; if it succeeds, swap it in and restart (exit code 1 when the build fails)
#   -Supervise   internal: the hidden supervisor loop started by this script
#   -Background  internal: a hidden copy doing an update build so -ServerOnly (wake, sign-in) returns at once
param([switch]$ServerOnly, [switch]$Dev, [switch]$Rebuild, [switch]$Supervise, [switch]$Background)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000"
$healthUrl = "http://127.0.0.1:3000/api/health" # the server listens on 127.0.0.1 only (see package.json)
$log = Join-Path $root "orbit-server.log"          # server output; the running server's cmd keeps it open
$buildLog = Join-Path $root "orbit-build.log"      # output of the last build
$launcherLog = Join-Path $root "orbit-launcher.log" # launcher and supervisor messages
$pidFile = Join-Path $root "orbit-server.pid" # supervisor + server PIDs, so stop.ps1 kills only ORBIT's processes
$distLive = Join-Path $root ".next"       # the release "npm run start" serves (next.config.ts distDir default)
$distNew = Join-Path $root ".next-build"  # where builds go (ORBIT_DIST_DIR) until they succeed
$distPrev = Join-Path $root ".next-prev"  # the previous release, for rollback
$buildId = Join-Path $distLive "BUILD_ID"
$failMark = Join-Path $distNew "BUILD_FAILED" # written when a build fails; stops retrying until an input changes
$buildFailedMsg = "Build failed $([char]0x2014) still running the previous version. Fix the errors, then npm run app:rebuild"
$noReleaseMsg = "Build failed and there is NO previous working version, so ORBIT runs in DEVELOPMENT mode (pages compile when first opened and requests can fail while compiling). Fix the errors, then npm run app:rebuild"

function Write-Log([string]$msg) {
  try { Add-Content -Path $launcherLog -Value ("{0:yyyy-MM-dd HH:mm:ss}  [orbit] {1}" -f (Get-Date), $msg) } catch { }
  Write-Host $msg
}

# True when something a build is made from changed after $file was written.
function Test-InputsNewer([string]$file) {
  $since = (Get-Item -LiteralPath $file).LastWriteTimeUtc
  $inputs = @(Get-ChildItem (Join-Path $root "src") -Recurse -File -ErrorAction SilentlyContinue)
  # NEXT_PUBLIC_* values in .env files are baked into the build, so they count too.
  $inputs += @(Get-ChildItem $root -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(package\.json|package-lock\.json|next\.config\.\w+|\.env.*)$' })
  return [bool]($inputs | Where-Object { $_.LastWriteTimeUtc -gt $since } | Select-Object -First 1)
}

# True when there is no production build or something it was built from changed since, unless a build already
# failed on exactly these inputs (then only "npm run app:rebuild" or an edit retries it, not every start or wake).
function Test-BuildStale {
  if ((Test-Path $failMark) -and -not (Test-InputsNewer $failMark)) { return $false }
  if (-not (Test-Path $buildId)) { return $true }
  return Test-InputsNewer $buildId
}

function Get-Health {
  try { Invoke-RestMethod $healthUrl -TimeoutSec 3 } catch { $null }
}

# Runs $action, retrying for ~15 s: Windows keeps files locked for a moment after a process dies (and antivirus,
# the search indexer or an editor may hold them too).
function Invoke-Retry([scriptblock]$action, [string]$what) {
  for ($i = 1; ; $i++) {
    try { & $action; return }
    catch {
      if ($i -ge 15) { throw "$what failed: $($_.Exception.Message)" }
      Start-Sleep -Seconds 1
    }
  }
}

# .next -> .next-prev (replacing the older one), .next-build -> .next. The server must be stopped first.
function Switch-Release {
  if (Test-Path $distPrev) { Invoke-Retry { Remove-Item -LiteralPath $distPrev -Recurse -Force } "Deleting .next-prev" }
  if (Test-Path $distLive) { Invoke-Retry { Rename-Item -LiteralPath $distLive -NewName ".next-prev" } "Renaming .next to .next-prev" }
  try { Invoke-Retry { Rename-Item -LiteralPath $distNew -NewName ".next" } "Renaming .next-build to .next" }
  catch {
    # Put the working release back before giving up.
    if (-not (Test-Path $distLive) -and (Test-Path $distPrev)) { Rename-Item -LiteralPath $distPrev -NewName ".next" -ErrorAction SilentlyContinue }
    throw
  }
  Write-Log "New build installed (the previous one is kept in .next-prev)."
}

# Builds into .next-build while whatever runs keeps running; only when the build succeeds is the server stopped
# ($stopFirst: the launcher; the supervisor has nothing running) and the build swapped in.
# Returns "built", "current" (another launcher just built it) or "failed".
function Update-Release([bool]$force, [bool]$stopFirst) {
  $buildMutex = New-Object System.Threading.Mutex($false, "Local\orbit-build")
  try { $null = $buildMutex.WaitOne() } catch [System.Threading.AbandonedMutexException] { } # abandoned = ours now
  try {
    if (-not $force -and -not (Test-BuildStale)) { return "current" }
    Write-Log "Building ORBIT into .next-build (npm run build, output in $buildLog); the current version keeps running meanwhile..."
    $buildStart = Get-Date
    $null = New-Item -ItemType Directory -Force -Path $distNew
    Remove-Item -LiteralPath (Join-Path $distNew "BUILD_ID") -Force -ErrorAction SilentlyContinue
    # Old route types in other dist folders are type-checked too (tsconfig includes them) and break the build after a
    # page is removed. They're only for type checking; the running server doesn't use them.
    foreach ($d in ".next", ".next-dev") { Remove-Item -LiteralPath (Join-Path $root "$d\types") -Recurse -Force -ErrorAction SilentlyContinue }
    # Reuse the build cache (not used by the running server) so the build isn't cold.
    $cache = Join-Path $distLive "cache\webpack"
    if ((Test-Path $cache) -and -not (Test-Path (Join-Path $distNew "cache\webpack"))) {
      try { $null = New-Item -ItemType Directory -Force -Path (Join-Path $distNew "cache"); Move-Item -LiteralPath $cache -Destination (Join-Path $distNew "cache\webpack") } catch { }
    }
    $env:ORBIT_DIST_DIR = ".next-build" # inherited by npm -> next build (read in next.config.ts)
    try {
      $b = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run build > `"$buildLog`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
      $null = $b.Handle; $b.WaitForExit() # not -Wait: in PowerShell 5.1 that waits for every descendant process too
    } finally { Remove-Item Env:ORBIT_DIST_DIR -ErrorAction SilentlyContinue }
    if ($b.ExitCode -ne 0 -or -not (Test-Path (Join-Path $distNew "BUILD_ID"))) {
      $null = New-Item -ItemType Directory -Force -Path $distNew # next build may have failed before creating it
      Set-Content -LiteralPath $failMark -Value (Get-Date -Format o)
      # Dated to the build's start, so a file saved while it ran counts as a change and the build is retried.
      (Get-Item -LiteralPath $failMark).LastWriteTime = $buildStart
      Write-Log "!!!!! BUILD FAILED (exit $($b.ExitCode)). The errors are in $buildLog"
      return "failed"
    }
    Remove-Item -LiteralPath $failMark -Force -ErrorAction SilentlyContinue
    Write-Log "Build finished; installing it."
    # Delete the oldest release before stopping the server, so it's down only for the two renames.
    if (Test-Path $distPrev) { Invoke-Retry { Remove-Item -LiteralPath $distPrev -Recurse -Force } "Deleting .next-prev" }
    if ($stopFirst) {
      & (Join-Path $PSScriptRoot "stop.ps1")
      for ($i = 0; (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) -and $i -lt 10; $i++) { Start-Sleep -Milliseconds 500 }
      if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw "port 3000 is still in use; not swapping" }
    }
    Switch-Release
    # next build pointed next-env.d.ts at .next-build, which is .next now.
    $envDts = Join-Path $root "next-env.d.ts"
    if (Test-Path $envDts) { try { Set-Content -LiteralPath $envDts -Value (Get-Content -LiteralPath $envDts -Raw).Replace(".next-build/", ".next/") -NoNewline } catch { } }
    return "built"
  } catch {
    Write-Log "!!!!! Couldn't build or install the new version: $($_.Exception.Message)"
    return "failed"
  } finally {
    $buildMutex.ReleaseMutex(); $buildMutex.Dispose()
  }
}

# ---- Supervisor: build if needed, run the server, restart it when it exits unexpectedly. ----
if ($Supervise) {
  $mutex = New-Object System.Threading.Mutex($false, "Local\orbit-supervisor")
  try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) { exit 0 } # one supervisor at a time
  try { Set-Content -LiteralPath $pidFile -Value $PID } catch { }
  $forceBuild = $Rebuild.IsPresent
  $crashes = @()
  $rebuilt = $false
  while ($true) {
    foreach ($f in $log, $launcherLog) { try { if ((Test-Path $f) -and (Get-Item $f).Length -gt 5MB) { Move-Item $f "$f.1" -Force } } catch { } }
    $devMode = $Dev.IsPresent
    if (-not $devMode) {
      if ($forceBuild -or (Test-BuildStale)) {
        if ((Update-Release $forceBuild $false) -eq "failed" -and (Test-Path $buildId)) { Write-Log "!!!!! $buildFailedMsg" }
        $forceBuild = $false
      }
      if (-not (Test-Path $buildId)) {
        Write-Log "!!!!! $noReleaseMsg"
        $devMode = $true
      }
    }
    $npmScript = if ($devMode) { "dev" } else { "start" }
    Write-Log "Starting ORBIT server (npm run $npmScript) on port 3000."
    $started = Get-Date
    $p = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run $npmScript >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $null = $p.Handle # Windows PowerShell 5.1: keeps ExitCode readable after the process exits
    try { Set-Content -LiteralPath $pidFile -Value @($PID, $p.Id) } catch { }
    $p.WaitForExit()
    # stop.ps1 kills this supervisor first, so reaching here always means an unexpected exit.
    $ran = ((Get-Date) - $started).TotalSeconds
    Write-Log ("ORBIT server exited unexpectedly (code {0}) after {1:N0} s." -f $p.ExitCode, $ran)
    if (-not $devMode -and $ran -lt 60 -and -not $rebuilt) {
      # A production server dying at boot usually means .next was overwritten (e.g. by a plain "npm run build"):
      # rebuild once. If that build fails, the current .next is kept.
      $forceBuild = $true
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
$launchStart = Get-Date
$buildFailed = $false
$built = $false
$tray = $null

function Show-Tray([string]$text) {
  if ($ServerOnly) { return }
  try {
    if (-not $script:tray) {
      $script:tray = New-Object System.Windows.Forms.NotifyIcon
      $script:tray.Icon = [System.Drawing.SystemIcons]::Information
      $script:tray.Visible = $true
    }
    $script:tray.ShowBalloonTip(15000, "ORBIT", $text, [System.Windows.Forms.ToolTipIcon]::Info)
  } catch { }
}

$health = Get-Health
if ($health -and -not $Dev) {
  # A running server keeps serving while the new build is made; it is only stopped once the build succeeded.
  # (A dev server you started yourself is left alone unless there's no release at all or you asked for -Rebuild.)
  $canReplace = ($health.mode -eq "production") -or $Rebuild -or -not (Test-Path $buildId)
  if ($canReplace -and $ServerOnly -and -not $Rebuild -and -not $Background -and (Test-BuildStale)) {
    # Wake / sign-in: the current version answers now; a hidden copy builds and swaps the update in afterwards.
    Write-Log "ORBIT changed; building the update in the background (output in $buildLog)."
    Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ServerOnly -Background" -WorkingDirectory $root -WindowStyle Hidden
  }
  elseif ($canReplace -and ($Rebuild -or (Test-BuildStale))) {
    Write-Host "Building ORBIT; the current version keeps running meanwhile. Progress: $buildLog"
    Show-Tray "Building ORBIT after an update. The current version keeps running meanwhile."
    $result = Update-Release $Rebuild.IsPresent $true
    if ($result -eq "built") { $health = $null; $built = $true } # stopped and swapped: start it again below
    elseif ($result -eq "current") { $health = Get-Health } # another launcher just built and restarted it
    elseif ($result -eq "failed") {
      $buildFailed = $true
      if (-not (Get-Health)) { $health = $null } # the install step may have stopped it: start the last release below
    }
  }
}
if ($health -and $health.mode -eq "production" -and -not $Dev) {
  # A manual "npm run build" replaces .next under the running server, which keeps serving (and breaking on) the old one.
  $diskId = "$(Get-Content $buildId -Raw -ErrorAction SilentlyContinue)".Trim()
  if ($health.buildId -and $diskId -and $diskId -ne $health.buildId) {
    Write-Log "ORBIT's build changed since the server started; restarting it on the new build."
    & (Join-Path $PSScriptRoot "stop.ps1")
    $health = $null
  }
}
if (-not $health) {
  $stale = (-not $Dev) -and (($Rebuild -and -not $buildFailed -and -not $built) -or (Test-BuildStale))
  # Port check, not HTTP: a server busy compiling can miss the timeout, and a second one would land on 3001.
  if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
    $supArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Supervise"
    if ($Dev) { $supArgs += " -Dev" }
    elseif ($stale -and $Rebuild) { $supArgs += " -Rebuild" }
    Start-Process powershell.exe -ArgumentList $supArgs -WorkingDirectory $root -WindowStyle Hidden
  }
  $limit = if ($stale) { 600 } else { 120 }
  if ($stale) {
    Write-Host "Building ORBIT after an update; this takes a minute or two. Progress: $buildLog"
    Show-Tray "Building ORBIT after an update. This takes a minute or two."
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
    try { $line = Get-Content $(if ($stale) { $buildLog } else { $log }) -Tail 1 -ErrorAction Stop; if ($line -and $line -ne $last) { Write-Host "  $line"; $last = $line } } catch { }
    Start-Sleep -Seconds 2
  }
  # The supervisor builds before it starts the server, so a build it just failed is already marked.
  if ((Test-Path $failMark) -and (Get-Item -LiteralPath $failMark).LastWriteTime -gt $launchStart) { $buildFailed = $true }
}
if ($tray) { $tray.Dispose() }

$failText = if ($health.mode -eq "development" -and -not $Dev) { $noReleaseMsg } else { $buildFailedMsg }
if ($buildFailed) {
  Write-Host ""
  Write-Host "!!!!! $failText" -ForegroundColor Red
  Write-Host "      Errors: $buildLog" -ForegroundColor Red
  Write-Host ""
}
if ($ServerOnly) { if ($Rebuild -and $buildFailed) { exit 1 } else { exit 0 } }

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

if ($buildFailed) {
  [System.Windows.Forms.MessageBox]::Show("$failText`n`nThe errors are in orbit-build.log in $root.", "ORBIT", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
} elseif ($health.mode -eq "development" -and -not $Dev) {
  [System.Windows.Forms.MessageBox]::Show("ORBIT is running in development mode (slower; requests can fail while a page compiles), because there is no working production build or a dev server was already running.`n`nSee orbit-server.log in $root. Then run: npm run app:rebuild", "ORBIT") | Out-Null
}
