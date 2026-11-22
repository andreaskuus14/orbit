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
#   -Watchdog    internal: the "ORBIT watchdog" scheduled task (every 5 min): start ORBIT if nothing is running it,
#                unless it was stopped on purpose (scripts\stop.ps1 writes orbit-stopped.flag; any normal start clears it)
param([switch]$ServerOnly, [switch]$Dev, [switch]$Rebuild, [switch]$Supervise, [switch]$Background, [switch]$Watchdog)
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
$stoppedFlag = Join-Path $root "orbit-stopped.flag" # stop.ps1: stopped on purpose, so the watchdog leaves it off
$updateFlag = Join-Path $root "orbit-update.request" # written by ORBIT (POST /api/system/update, owner only): pull main + rebuild while running
$updateLog = Join-Path $root "orbit-update.log"      # output of the self-update's git pull and npm ci
$busyUrl = "http://127.0.0.1:3000/api/studio/busy"  # auth-free, localhost only: is a clip render, download, scout run or publish going?
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
function Update-Release([bool]$force, [bool]$stopFirst, [scriptblock]$stopServer = $null) {
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
    $env:ORBIT_FAST_PROD_BUILD = "1"    # main commits are already typechecked/linted in CI; cuts live swap build time
    try {
      $b = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run build > `"$buildLog`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
      $null = $b.Handle; $b.WaitForExit() # not -Wait: in PowerShell 5.1 that waits for every descendant process too
    } finally {
      Remove-Item Env:ORBIT_DIST_DIR -ErrorAction SilentlyContinue
      Remove-Item Env:ORBIT_FAST_PROD_BUILD -ErrorAction SilentlyContinue
    }
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
    if ($stopServer) { & $stopServer } # the supervisor's own running server (stop.ps1 would kill the supervisor too)
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

# ---- Self-update helpers (the supervisor's orbit-update.request handling) ----

# Runs a native program; returns @{ Code; Out } (stdout and stderr as text). Windows PowerShell 5.1 turns a native
# program's stderr into a terminating error under "Stop" (git and taskkill write notes there), so this function's
# scope uses "Continue" and the caller checks Code.
function Invoke-Native([string]$exe, [string[]]$argv) {
  $ErrorActionPreference = "Continue" # local to this function
  $global:LASTEXITCODE = 0
  try { $out = & $exe @argv 2>&1 | ForEach-Object { "$_" } | Out-String }
  catch { return @{ Code = -1; Out = $_.Exception.Message } }
  return @{ Code = $LASTEXITCODE; Out = "$out".Trim() }
}

# Runs $cmdLine hidden through cmd.exe in the ORBIT folder, output appended to orbit-update.log, for at most
# $timeoutSec (a credential prompt or a dead network must never hang the hidden supervisor). Returns the exit code,
# or -1 when it timed out and was killed.
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) {
  try { Add-Content -LiteralPath $updateLog -Value ("{0:yyyy-MM-dd HH:mm:ss}  > {1}" -f (Get-Date), $cmdLine) } catch { }
  $q = Start-Process cmd.exe -ArgumentList "/c", "$cmdLine >> `"$updateLog`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $null = $q.Handle # keeps ExitCode readable (5.1)
  if (-not $q.WaitForExit($timeoutSec * 1000)) {
    $null = Invoke-Native "taskkill.exe" @("/PID", "$($q.Id)", "/T", "/F")
    $null = $q.WaitForExit(10000)
    return -1
  }
  return $q.ExitCode
}

function Get-Head {
  $r = Invoke-Native "git" @("-C", $root, "rev-parse", "HEAD")
  if ($r.Code -eq 0) { return $r.Out } else { return "" }
}

function Get-Short([string]$sha) { if ($sha.Length -gt 8) { return $sha.Substring(0, 8) } else { return $sha } }

# Pulls main fast-forward only (no prompts, 2-minute limit). Returns @{ Ok; Old; New; LockChanged }:
# Ok false = the pull failed (logged), so nothing may be built from it.
function Sync-Main {
  $old = Get-Head
  $res = @{ Ok = $true; Old = $old; New = $old; LockChanged = $false }
  $branch = Invoke-Native "git" @("-C", $root, "rev-parse", "--abbrev-ref", "HEAD")
  if ($branch.Code -ne 0 -or -not $old) {
    Write-Log "!!!!! git rev-parse failed (exit $($branch.Code)): $($branch.Out -replace '\s+', ' ')"
    $res.Ok = $false; return $res
  }
  if ($branch.Out -ne "main") {
    Write-Log "Not on main ($($branch.Out)): not pulling; building the checked-out code only if it changed."
    return $res
  }
  # No credential prompts: git's own (GIT_TERMINAL_PROMPT), Git Credential Manager's window, or ssh asking for a passphrase.
  $saved = @{}
  $noPrompt = @{ GIT_TERMINAL_PROMPT = "0"; GCM_INTERACTIVE = "never" }
  if (-not $env:GIT_SSH_COMMAND) { $noPrompt.GIT_SSH_COMMAND = "ssh -o BatchMode=yes" }
  foreach ($k in $noPrompt.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process"); [Environment]::SetEnvironmentVariable($k, $noPrompt[$k], "Process") }
  try { $code = Invoke-Hidden "git pull --ff-only" 120 }
  finally { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process") } }
  if ($code -ne 0) {
    if ($code -eq -1) { Write-Log "!!!!! git pull timed out after 120 s (waiting for credentials or the network?) and was stopped. Details: $updateLog" }
    else { Write-Log "!!!!! git pull failed (exit $code; not a fast-forward, local changes, or no access). Details: $updateLog" }
    $res.Ok = $false; return $res
  }
  $res.New = Get-Head
  if (-not $res.New) { Write-Log "!!!!! git rev-parse failed after the pull."; $res.Ok = $false; return $res }
  if ($res.New -ne $old) {
    $d = Invoke-Native "git" @("-C", $root, "diff", "--name-only", $old, $res.New)
    # If the diff can't be read, assume the lockfile changed: an unneeded npm ci is slow, a missing one breaks the build.
    $res.LockChanged = ($d.Code -ne 0) -or (@($d.Out -split "\r?\n") -contains "package-lock.json")
    Write-Log ("git pull: {0} -> {1}{2}" -f (Get-Short $old), (Get-Short $res.New), $(if ($res.LockChanged) { " (package-lock.json changed)" } else { "" }))
  }
  return $res
}

# Waits up to $timeoutSec for Studio work (clip renders, downloads, a scout run, a publish) to finish, so a restart
# doesn't kill it halfway. A scout run that's only due later (scoutPending) doesn't count. No answer = go ahead.
# Returns $true when idle, $false when it gave up waiting.
function Wait-StudioIdle([int]$timeoutSec = 600) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  $said = ""
  while ($true) {
    try { $b = Invoke-RestMethod $busyUrl -TimeoutSec 5 }
    catch { Write-Log "Couldn't ask ORBIT whether Studio is busy ($($_.Exception.Message)); going ahead."; return $true }
    $running = @("clips", "downloads", "scout", "publishing" | Where-Object { $b.$_ -eq $true })
    if ($running.Count -eq 0) { return $true }
    $what = $running -join ", "
    if ((Get-Date) -ge $deadline) { Write-Log "!!!!! Studio is still busy after $([int]($timeoutSec / 60)) min ($what); restarting anyway."; return $false }
    if ($what -ne $said) { Write-Log "Waiting for Studio work to finish before restarting ORBIT: $what."; $said = $what }
    Start-Sleep -Seconds 10
  }
}

# Ends the server's process tree (cmd -> npm -> next). taskkill reports a process that already exited as an error; ignored.
function Stop-Server($proc) {
  if (-not $proc -or $proc.HasExited) { return }
  $k = Invoke-Native "taskkill.exe" @("/PID", "$($proc.Id)", "/T", "/F")
  if (-not $proc.WaitForExit(15000)) { Write-Log "!!!!! The server (PID $($proc.Id)) didn't stop: taskkill exit $($k.Code): $($k.Out -replace '\s+', ' ')" }
}

function Start-Server([string]$npmScript) {
  Write-Log "Starting ORBIT server (npm run $npmScript) on port 3000."
  $proc = Start-Process cmd.exe -ArgumentList "/c", "npm.cmd run $npmScript >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $null = $proc.Handle # Windows PowerShell 5.1: keeps ExitCode readable after the process exits
  try { Set-Content -LiteralPath $pidFile -Value @($PID, $proc.Id) } catch { }
  return $proc
}

# After an update swap. "ok": the server answered /api/health with the new BUILD_ID and was still running after
# $timeoutSec; "exited": it stopped within $timeoutSec; "timeout": it never answered with the new build.
function Wait-NewRelease($proc, [string]$expectId, [int]$timeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    if ($proc.WaitForExit(2000)) { return "exited" }
    if (-not $healthy) {
      $h = Get-Health
      # The build id check: an old server still dying on the port mustn't count as the new one answering.
      if ($h -and (-not $expectId -or "$($h.buildId)" -eq $expectId)) { $healthy = $true }
    }
  }
  if ($healthy) { return "ok" } else { return "timeout" }
}

# Undoes an update swap (the server must be stopped): the bad .next becomes .next-build (keeps its build cache for
# the next try), .next-prev becomes .next again, and BUILD_FAILED stops the same commit from being rebuilt on its
# own (a new commit, an edit or a forced rebuild retries). Returns $false when there's nothing to go back to.
function Restore-PrevRelease([string]$reason, [string]$commit) {
  if (-not (Test-Path (Join-Path $distPrev "BUILD_ID"))) { Write-Log "!!!!! $reason, and there is no previous version (.next-prev) to go back to."; return $false }
  try {
    if (Test-Path $distNew) { Invoke-Retry { Remove-Item -LiteralPath $distNew -Recurse -Force } "Deleting .next-build" }
    if (Test-Path $distLive) { Invoke-Retry { Rename-Item -LiteralPath $distLive -NewName ".next-build" } "Renaming .next to .next-build" }
    Invoke-Retry { Rename-Item -LiteralPath $distPrev -NewName ".next" } "Renaming .next-prev to .next"
  } catch {
    if (-not (Test-Path $distLive) -and (Test-Path $distNew)) { Rename-Item -LiteralPath $distNew -NewName ".next" -ErrorAction SilentlyContinue }
    Write-Log "!!!!! Rollback failed: $($_.Exception.Message)"
    return $false
  }
  $null = New-Item -ItemType Directory -Force -Path $distNew
  $note = "Update to $(Get-Short $commit) rolled back: $reason. Server output: orbit-server.log"
  Set-Content -LiteralPath $failMark -Value "$(Get-Date -Format o) $note"
  try { Add-Content -LiteralPath $buildLog -Value $note } catch { } # the doctor shows the build log's first error line
  Write-Log "!!!!! UPDATE ROLLED BACK: $reason. The previous version is back in .next; commit $(Get-Short $commit) won't be rebuilt until it changes (or a forced rebuild)."
  return $true
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
  $verify = $null # set after an update swap: the new release must prove itself or it is rolled back
  while ($true) {
    foreach ($f in $log, $launcherLog, $updateLog) { try { if ((Test-Path $f) -and (Get-Item $f).Length -gt 5MB) { Move-Item $f "$f.1" -Force } } catch { } }
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
    $started = Get-Date
    $p = Start-Server $npmScript
    if ($verify) {
      # Never leave ORBIT down on a bad update: the new release must answer /api/health and keep running for 2
      # minutes, or the previous one is swapped back in and started.
      $v = Wait-NewRelease $p $verify.Id 120
      if ($v -eq "ok") { Write-Log "Update verified: $(Get-Short $verify.Commit) answers and kept running for 2 minutes." }
      else {
        $why = if ($v -eq "exited") { "the new version stopped (exit code $($p.ExitCode)) within 2 minutes" } else { "the new version didn't answer /api/health within 2 minutes" }
        Write-Log "!!!!! $why; rolling back to the previous version."
        Stop-Server $p
        $badCommit = $verify.Commit
        $verify = $null
        # $rebuilt: if the old release then dies at boot too, don't force-rebuild the commit that just failed.
        if (Restore-PrevRelease $why $badCommit) { $rebuilt = $true; $crashes = @(); continue }
      }
      $verify = $null
    }
    $updated = $false
    # Wait for the server, checking every 5 s for an update request from ORBIT itself (the owner's click or a Claude
    # session acting for him through ORBIT). Main is pulled fast-forward only; the build runs while the server keeps
    # serving, and only a successful build stops it for the swap. A failed pull or build changes nothing.
    while (-not $p.WaitForExit(5000)) {
      if (-not (Test-Path $updateFlag)) { continue }
      $forced = "$(Get-Content -LiteralPath $updateFlag -Raw -ErrorAction SilentlyContinue)" -match 'rebuild'
      Remove-Item -LiteralPath $updateFlag -Force -ErrorAction SilentlyContinue
      $handled = Get-Date
      Write-Log ("Update requested from ORBIT{0}: pulling main." -f $(if ($forced) { " (forced rebuild)" } else { "" }))
      $sync = Sync-Main
      if (-not $sync.Ok) { Write-Log "!!!!! Update skipped: nothing was built, ORBIT keeps running the current version."; continue }
      $changed = $sync.New -ne $sync.Old
      if ($sync.LockChanged) {
        # npm ci replaces node_modules, which the running server loads from (and Windows keeps its native modules
        # locked), so the server stops for it and the current release starts again right after.
        Write-Log "Dependencies changed: stopping ORBIT for npm ci (output in $updateLog)."
        $null = Wait-StudioIdle
        Stop-Server $p
        $ci = Invoke-Hidden "npm.cmd ci" 900
        if ($ci -ne 0) {
          Write-Log ("!!!!! npm ci {0}; not building. Going back to {1} and its dependencies. Details: {2}" -f $(if ($ci -eq -1) { "timed out after 15 min" } else { "failed (exit $ci)" }), (Get-Short $sync.Old), $updateLog)
          $back = Invoke-Native "git" @("-C", $root, "reset", "--keep", $sync.Old)
          if ($back.Code -ne 0) { Write-Log "!!!!! git reset --keep $(Get-Short $sync.Old) failed: $($back.Out -replace '\s+', ' ')" }
          else {
            $ci = Invoke-Hidden "npm.cmd ci" 900
            if ($ci -ne 0) { Write-Log "!!!!! npm ci for the previous commit failed too (exit $ci); starting the current release anyway. Run npm ci by hand." }
          }
          $started = Get-Date; $p = Start-Server "start"
          continue
        }
        Write-Log "npm ci done; the current release runs again while the update builds."
        $started = Get-Date; $p = Start-Server "start"
      }
      # Build when main moved or a rebuild was asked for; otherwise only when the inputs changed since the last build
      # (Update-Release without force also honours BUILD_FAILED, so a commit that failed isn't rebuilt on every click).
      $r = Update-Release ($changed -or $forced) $false { $null = Wait-StudioIdle; Stop-Server $p }
      if ($r -eq "current") {
        if ((Test-Path $failMark) -and -not (Test-InputsNewer $failMark)) { Write-Log "Nothing new on main since $(Get-Short $sync.New), which failed before (see $buildLog); not retrying. Push a fix, or request a forced rebuild." }
        else { Write-Log "Already up to date ($(Get-Short $sync.New)); nothing to build." }
      }
      # A rebuild request that came in while this update pulled and built was answered by it: drop it. A plain request
      # is kept; its pull finds nothing new (no second build) unless main moved meanwhile.
      if ($r -ne "current" -and (Test-Path $updateFlag) -and "$(Get-Content -LiteralPath $updateFlag -Raw -ErrorAction SilentlyContinue)" -match 'rebuild') {
        Remove-Item -LiteralPath $updateFlag -Force -ErrorAction SilentlyContinue
        Write-Log ("Ignored a rebuild request made while the one from {0:HH:mm:ss} ran." -f $handled)
      }
      if ($r -eq "built") { $updated = $true; $verify = @{ Id = "$(Get-Content $buildId -Raw -ErrorAction SilentlyContinue)".Trim(); Commit = $sync.New }; break }
      if ($r -eq "failed") { Write-Log "!!!!! $buildFailedMsg" }
    }
    if ($updated) { Write-Log "Update installed; starting the new version."; $crashes = @(); continue }
    # stop.ps1 kills this supervisor first, so reaching here always means an unexpected exit.
    $ran = ((Get-Date) - $started).TotalSeconds
    Write-Log ("ORBIT server exited unexpectedly (code {0}) after {1:N0} s." -f $p.ExitCode, $ran)
    if ($p.ExitCode -eq 70) {
      # Controlled stop (crash-log.ts CONTROLLED_STOP_EXIT): an uncaught exception, already logged to crash.log. The build is fine: just restart.
      Write-Log "Controlled stop after an uncaught error (see crash.log); restarting without a rebuild."
    }
    elseif (-not $devMode -and $ran -lt 60 -and -not $rebuilt) {
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

# ---- Watchdog (scheduled task, every 5 min) ----
if ($Watchdog) {
  if ((Test-Path $stoppedFlag) -or $env:ORBIT_WATCHDOG -eq "0") { exit 0 } # stopped on purpose / turned off
  if (Get-Health) { exit 0 }
  # A launcher, supervisor, build or server of this folder is already at work (starting, building, swapping): let it.
  $busy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf("$root\", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match 'launch\.ps1|next' })
  if ($busy.Count -gt 0) { exit 0 }
  Write-Log "Watchdog: ORBIT wasn't running and wasn't stopped on purpose; starting it."
  $ServerOnly = [switch]$true
}

# The watchdog task: created once per user (no admin needed), runs hidden every 5 min. ORBIT_WATCHDOG=0 skips it.
function Install-Watchdog {
  if ($env:ORBIT_WATCHDOG -eq "0") { return }
  $q = Invoke-Native "schtasks.exe" @("/query", "/tn", "ORBIT watchdog")
  if ($q.Code -eq 0) { return }
  # Windows PowerShell 5.1 mangles embedded quotes in native arguments, so the path goes unquoted when it can.
  $file = if ($PSCommandPath -match '\s') { "\`"$PSCommandPath\`"" } else { $PSCommandPath }
  $tr = "conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File $file -Watchdog"
  $c = Invoke-Native "schtasks.exe" @("/create", "/tn", "ORBIT watchdog", "/sc", "minute", "/mo", "5", "/tr", $tr, "/f")
  if ($c.Code -eq 0) { Write-Log "Installed the ORBIT watchdog task: every 5 min it starts ORBIT if it isn't running (npm run app:stop keeps it off)." }
  else { Write-Log "Couldn't install the watchdog task: $($c.Out)" }
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
# Running again: not "stopped on purpose" any more, and the watchdog task exists from now on.
Remove-Item -LiteralPath $stoppedFlag -Force -ErrorAction SilentlyContinue
if (-not $Watchdog) { try { Install-Watchdog } catch { Write-Log "Watchdog setup failed: $($_.Exception.Message)" } }
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
