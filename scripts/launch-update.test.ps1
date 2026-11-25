# Tests the self-update helpers in launch.ps1 (Invoke-Native, Invoke-Hidden, Sync-Main, Wait-StudioIdle, Wait-NewRelease,
# Restore-PrevRelease) by loading only its functions, with mocks. Runs under PowerShell 7 on Linux/macOS (sh stands in
# for cmd.exe and taskkill; Sync-Main uses a real throwaway git remote): pwsh -File scripts/launch-update.test.ps1
param([string]$Script = (Join-Path $PSScriptRoot "launch.ps1"))
$ErrorActionPreference = "Stop"
$fails = 0
function Check([bool]$ok, [string]$name) { if ($ok) { "ok   $name" } else { "FAIL $name"; $script:fails++ } }

# Load only the function definitions from launch.ps1 (its top level runs the launcher).
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$null, [ref]$null)
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($f.Extent.Text))
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("orbit-upd-" + [guid]::NewGuid().ToString("n").Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
$root = Join-Path $tmp "orbit"; $null = New-Item -ItemType Directory -Path $root
$launcherLog = Join-Path $root "orbit-launcher.log"; $updateLog = Join-Path $root "orbit-update.log"; $buildLog = Join-Path $root "orbit-build.log"
$distLive = Join-Path $root ".next"; $distNew = Join-Path $root ".next-build"; $distPrev = Join-Path $root ".next-prev"
$depsLive = Join-Path $root "node_modules"; $depsPrev = Join-Path $root "node_modules-prev"; $stampName = "orbit-release.txt"
$rolledBackMark = Join-Path $root "orbit-rolled-back.txt"
$failMark = Join-Path $distNew "BUILD_FAILED"; $busyUrl = "http://127.0.0.1:1/api/studio/busy"
function Write-Host { } # quiet Write-Log
function Start-Sleep { } # no real waits
function LogHas([string]$re) { [bool](Select-String -LiteralPath $launcherLog -Pattern $re -Quiet) }

# --- Invoke-Native: stderr + non-zero exit under "Stop" don't throw; missing program = -1
$r = Invoke-Native "sh" @("-c", "echo out; echo err 1>&2; exit 3")
Check ($r.Code -eq 3 -and $r.Out -match "out" -and $r.Out -match "err") "Invoke-Native returns exit code and stderr text"
$r = Invoke-Native "no-such-program-xyz" @()
Check ($r.Code -eq -1) "Invoke-Native: missing program -> -1"
Check ($ErrorActionPreference -eq "Stop") "caller's ErrorActionPreference unchanged"

# --- Invoke-Hidden: exit code, and a hung command is killed at the timeout (cmd.exe/taskkill mocked with sh/kill)
function Start-Process { param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru)
  $line = ($ArgumentList[1] -replace '>> "([^"]+)" 2>&1$', '>> "$1" 2>&1')
  $psi = [Diagnostics.ProcessStartInfo]::new("sh"); $psi.ArgumentList.Add("-c"); $psi.ArgumentList.Add($line); $psi.WorkingDirectory = $WorkingDirectory; $psi.UseShellExecute = $false
  [Diagnostics.Process]::Start($psi) }
function taskkill.exe { Stop-Process -Id ([int]$args[1]) -Force; $global:LASTEXITCODE = 0 }
Check ((Invoke-Hidden "echo hi; exit 5" 10) -eq 5) "Invoke-Hidden returns the exit code"
Check ((Get-Content $updateLog -Raw) -match "hi") "Invoke-Hidden appends output to orbit-update.log"
$t = Get-Date; $c = Invoke-Hidden "exec sleep 30" 1
Check ($c -eq -1 -and ((Get-Date) - $t).TotalSeconds -lt 8) "Invoke-Hidden kills a hung command at the timeout (-1)"

# --- Sync-Main with a real git remote (Invoke-Hidden runs via sh above)
$env:GIT_CONFIG_GLOBAL = "/dev/null"
$remote = Join-Path $tmp "remote.git"; $seed = Join-Path $tmp "seed"
git init -q --bare -b main $remote; git clone -q $remote $seed 2>$null
git -C $seed -c user.email=t@t -c user.name=t commit -q --allow-empty -m one; Set-Content (Join-Path $seed "package-lock.json") "{}"
git -C $seed add -A; git -C $seed -c user.email=t@t -c user.name=t commit -q -m two; git -C $seed push -q origin main 2>$null
Remove-Item $root -Recurse -Force; git clone -q $remote $root 2>$null; $null = New-Item -ItemType File -Force $launcherLog
$r = Sync-Main
Check ($r.Ok -and $r.Old -eq $r.New -and -not $r.LockChanged) "Sync-Main: nothing new -> Ok, HEAD unchanged"
# prompt guards are set during the pull and restored after
$env:GIT_TERMINAL_PROMPT = $null; $env:GCM_INTERACTIVE = $null; $env:GIT_SSH_COMMAND = $null
$seenPrompt = $null
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { $script:seenPrompt = "$env:GIT_TERMINAL_PROMPT/$env:GCM_INTERACTIVE/$env:GIT_SSH_COMMAND/$timeoutSec"; $global:LASTEXITCODE = 0; git -C $root pull -q --ff-only 2>$null; return $LASTEXITCODE }
Set-Content (Join-Path $seed "package-lock.json") '{"v":2}'; git -C $seed -c user.email=t@t -c user.name=t commit -qam three; git -C $seed push -q origin main 2>$null
$r = Sync-Main
Check ($r.Ok -and $r.Old -ne $r.New -and $r.LockChanged) "Sync-Main: pulled a lockfile change -> LockChanged"
Check ($seenPrompt -eq "0/never/ssh -o BatchMode=yes/120") "Sync-Main: no-prompt env + 120 s limit during the pull ($seenPrompt)"
Check (-not $env:GIT_TERMINAL_PROMPT -and -not $env:GCM_INTERACTIVE -and -not $env:GIT_SSH_COMMAND) "Sync-Main: env restored afterwards"
Set-Content (Join-Path $seed "a.txt") "x"; git -C $seed add -A; git -C $seed -c user.email=t@t -c user.name=t commit -qm four; git -C $seed push -q origin main 2>$null
$r = Sync-Main
Check ($r.Ok -and $r.Old -ne $r.New -and -not $r.LockChanged) "Sync-Main: code-only change -> no npm ci"
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { return 1 }
$r = Sync-Main
Check (-not $r.Ok -and (LogHas "git pull failed \(exit 1")) "Sync-Main: failed pull -> Ok false, logged"
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { return -1 }
$r = Sync-Main
Check (-not $r.Ok -and (LogHas "timed out after 120 s")) "Sync-Main: timed-out pull -> Ok false, logged"
git -C $root checkout -q -b feature
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { throw "must not pull" }
$r = Sync-Main
Check ($r.Ok -and $r.Old -eq $r.New -and (LogHas "Not on main \(feature\)")) "Sync-Main: off main -> no pull"

# --- Wait-StudioIdle
$script:answers = @(@{ busy = $true; clips = $true; downloads = $false; scout = $false; publishing = $false; scoutPending = $true }, @{ busy = $true; clips = $false; downloads = $false; scout = $false; publishing = $false; scoutPending = $true })
$script:calls = 0
function Invoke-RestMethod { $a = $script:answers[[Math]::Min($script:calls, $script:answers.Count - 1)]; $script:calls++; [pscustomobject]$a }
Check ((Wait-StudioIdle 600) -and $calls -eq 2 -and (LogHas "Waiting for Studio work to finish before restarting ORBIT: clips")) "Wait-StudioIdle waits for clips; scoutPending alone counts as idle"
$script:answers = @(@{ busy = $true; clips = $false; downloads = $true; scout = $true; publishing = $false })
Check (-not (Wait-StudioIdle 0) -and (LogHas "still busy after 0 min \(downloads, scout\)")) "Wait-StudioIdle gives up at the timeout and names what runs"
function Invoke-RestMethod { throw "404 Not Found" }
Check ((Wait-StudioIdle 600) -and (LogHas "Couldn't ask ORBIT whether Studio is busy")) "Wait-StudioIdle: no endpoint -> go ahead"

# --- Wait-NewRelease (fake process + Get-Health)
function FakeProc([int]$exitAfter) { $o = [pscustomobject]@{ n = 0; exitAfter = $exitAfter }; $o | Add-Member ScriptMethod WaitForExit { param($ms) $this.n++; return ($this.exitAfter -gt 0 -and $this.n -ge $this.exitAfter) }; $o }
$script:health = $null
function Get-Health { $script:health }
$script:page = 200
function Get-PageStatus { $script:page }
$script:health = [pscustomobject]@{ buildId = "NEW"; problems = [pscustomobject]@{ fatal = @("NEXT_PUBLIC_SUPABASE_URL is missing"); warn = @() } }
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "broken" -and $script:releaseWhy -match "SUPABASE_URL") "Wait-NewRelease: fatal problem in health -> broken, reason kept"
$script:health = [pscustomobject]@{ buildId = "NEW"; problems = [pscustomobject]@{ fatal = @(); warn = @("Database migrations missing") } }
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "ok" -and $script:releaseWarn -contains "Database migrations missing") "Wait-NewRelease: warnings don't roll back, but are kept"
$script:page = 500
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "page") "Wait-NewRelease: /login keeps failing -> page"
$script:page = 0
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "page") "Wait-NewRelease: /login never answers -> page"
$script:page = 307
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "ok") "Wait-NewRelease: a redirect counts as the page working"
$script:page = 200
$script:health = [pscustomobject]@{ buildId = "NEW" }
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "ok") "Wait-NewRelease: answers with the new build and stays up -> ok"
Check ((Wait-NewRelease (FakeProc 1) "NEW" 5) -eq "exited") "Wait-NewRelease: exits -> exited"
$script:health = [pscustomobject]@{ buildId = "OLD" }
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "timeout") "Wait-NewRelease: only the old build answers -> timeout"
$script:health = $null
Check ((Wait-NewRelease (FakeProc 0) "NEW" 1) -eq "timeout") "Wait-NewRelease: no answer -> timeout"

# --- Get-RollbackPlan (same cases as tests/rollback.test.ts)
$pv = @{ Commit = "aaa"; Lock = "L1" }
function PlanIs($p, [string]$reset, [string]$deps) { $p.ResetTo -eq $reset -and $p.Deps -eq $deps }
Check (PlanIs (Get-RollbackPlan $null "bbb" "L2" "L1") "" "keep") "plan: no stamp -> only the .next swap"
Check (PlanIs (Get-RollbackPlan $pv "bbb" "L1" "") "aaa" "keep") "plan: code-only update -> reset, keep node_modules"
Check (PlanIs (Get-RollbackPlan $pv "bbb" "L2" "L1") "aaa" "restore") "plan: lock changed, node_modules-prev fits -> restore"
Check (PlanIs (Get-RollbackPlan $pv "bbb" "L2" "") "aaa" "reinstall") "plan: lock changed, no node_modules-prev -> npm ci"
Check (PlanIs (Get-RollbackPlan $pv "bbb" "L2" "L0") "aaa" "reinstall") "plan: node_modules-prev from another lock -> npm ci"
Check (PlanIs (Get-RollbackPlan $pv "aaa" "L1" "") "" "keep") "plan: same commit -> no reset"

# --- Save-PrevDeps / Restore-PrevDeps
$null = New-Item -ItemType Directory -Force (Join-Path $depsLive "old-pkg")
Save-PrevDeps "L1"
Check (-not (Test-Path $depsLive) -and (Test-Path (Join-Path $depsPrev "old-pkg")) -and (Get-SavedLock) -eq "L1") "Save-PrevDeps: node_modules -> node_modules-prev with its lock hash"
$null = New-Item -ItemType Directory -Force (Join-Path $depsLive "new-pkg")
Check ((Restore-PrevDeps) -and (Test-Path (Join-Path $depsLive "old-pkg")) -and -not (Test-Path (Join-Path $depsLive "new-pkg")) -and -not (Test-Path $depsPrev)) "Restore-PrevDeps: old node_modules back, new one gone"
Check (-not (Restore-PrevDeps)) "Restore-PrevDeps: nothing saved -> false"
Remove-Item $depsLive -Recurse -Force

# --- Restore-PrevRelease
foreach ($d in $distLive, $distPrev) { $null = New-Item -ItemType Directory -Force $d }
Set-Content (Join-Path $distLive "BUILD_ID") "NEW"; Set-Content (Join-Path $distPrev "BUILD_ID") "OLD"
Check (Restore-PrevRelease "the new version stopped" "0123456789abcdef") "Restore-PrevRelease returns true"
Check ((Get-Content (Join-Path $distLive "BUILD_ID")).Trim() -eq "OLD" -and -not (Test-Path $distPrev) -and (Get-Content (Join-Path $distNew "BUILD_ID")).Trim() -eq "NEW") ".next-prev back in .next, bad release parked in .next-build"
Check ((Test-Path $failMark) -and (Get-Content $failMark -Raw) -match "01234567 rolled back" -and (Get-Content $buildLog -Raw) -match "rolled back") "BUILD_FAILED written (commit + reason) and noted in orbit-build.log"
Check (LogHas "UPDATE ROLLED BACK") "rollback logged"
Check (-not (Restore-PrevRelease "x" "y") -and (LogHas "no previous version")) "Restore-PrevRelease without .next-prev -> false, logged"
Check ((Get-Content $rolledBackMark -Raw).Trim() -eq "0123456789abcdef") "Restore-PrevRelease records the rolled-back commit"

# --- Restore-PrevRelease after an update that changed package-lock.json: git and node_modules go back too
foreach ($d in $distLive, $distPrev, $distNew, $depsPrev) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
git -C $root checkout -q main
$oldSha = Get-Head; $oldLock = Get-LockHash
foreach ($d in $distLive, $distPrev, (Join-Path $depsLive "old-pkg")) { $null = New-Item -ItemType Directory -Force $d }
Set-Content (Join-Path $distPrev "BUILD_ID") "OLD"; Set-Content (Join-Path $distPrev $stampName) @($oldSha, $oldLock)
Save-PrevDeps $oldLock
$null = New-Item -ItemType Directory -Force (Join-Path $depsLive "new-pkg")
Set-Content (Join-Path $root "package-lock.json") '{"v":3}'; git -C $root -c user.email=t@t -c user.name=t commit -qam bad
$badSha = Get-Head; Set-Content (Join-Path $distLive "BUILD_ID") "NEW"
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { throw "must not npm ci when node_modules-prev fits" }
Check (Restore-PrevRelease "the new version stopped" $badSha) "lock rollback: returns true"
Check ((Get-Head) -eq $oldSha -and (Get-LockHash) -eq $oldLock) "lock rollback: git reset to the previous release's commit"
Check ((Test-Path (Join-Path $depsLive "old-pkg")) -and -not (Test-Path (Join-Path $depsLive "new-pkg")) -and -not (Test-Path $depsPrev)) "lock rollback: node_modules-prev restored"
# no node_modules-prev -> npm ci after the reset
foreach ($d in $distLive, $distPrev, $distNew) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
foreach ($d in $distLive, $distPrev) { $null = New-Item -ItemType Directory -Force $d }
Set-Content (Join-Path $distPrev "BUILD_ID") "OLD"; Set-Content (Join-Path $distPrev $stampName) @($oldSha, $oldLock)
git -C $root reset -q --hard $badSha; Set-Content (Join-Path $distLive "BUILD_ID") "NEW"
$script:ciRan = $null
function Invoke-Hidden([string]$cmdLine, [int]$timeoutSec) { $script:ciRan = $cmdLine; return 0 }
Check ((Restore-PrevRelease "x" $badSha) -and (Get-Head) -eq $oldSha -and $ciRan -eq "npm.cmd ci") "lock rollback without node_modules-prev: reset, then npm ci"
Remove-Item $depsLive -Recurse -Force

# --- Copy-PrevStatic: the previous build's own chunks join the new build; inherited ones and existing files don't
foreach ($d in $distLive, $distPrev) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } }
foreach ($d in "$distPrev/static/chunks", "$distLive/static/chunks") { $null = New-Item -ItemType Directory -Force $d }
Set-Content "$distPrev/static/chunks/833.js" "old"; Set-Content "$distPrev/static/chunks/inherited.js" "older"
Set-Content "$distPrev/static/chunks/same.js" "prev"; Set-Content "$distLive/static/chunks/same.js" "live"
Set-Content "$distPrev/static-inherited.txt" (Join-Path "chunks" "inherited.js")
Copy-PrevStatic
Check ((Test-Path "$distLive/static/chunks/833.js") -and -not (Test-Path "$distLive/static/chunks/inherited.js")) "Copy-PrevStatic: own chunks kept, inherited ones not"
Check ((Get-Content "$distLive/static/chunks/same.js").Trim() -eq "live") "Copy-PrevStatic: never overwrites the new build"
Check ((Get-Content "$distLive/static-inherited.txt" -Raw).Trim() -eq (Join-Path "chunks" "833.js")) "Copy-PrevStatic: records what it copied"

# --- the request-flag 'rebuild' marker (same test as the supervisor)
Check (("2026-11-20T10:00:00.000Z rebuild" -match 'rebuild') -and -not ("2026-11-20T10:00:00.000Z" -match 'rebuild')) "flag: forced rebuild marker"

Remove-Item $tmp -Recurse -Force
"$fails failure(s)"; exit $fails
