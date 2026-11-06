# Windows verification of the self-development setup on a DISPOSABLE machine (GitHub Actions windows-latest). Never run on the PC:
# it creates accounts, ACLs and SYSTEM tasks and turns unattended releases on for its own drill.
# ORBIT runs isolated (ORBIT_ISOLATED=1, dummy Supabase, own data folder, no keys); "GitHub" is a local bare repo; no model.
# Checks: installer; boundary probes as orbit-builder (as a test), as orbit-build (directly, during next build via the real release
# pipeline, and in a dependency install script); scheduled-task build/install; ORBIT Stop-all hold; a locked live file during
# install; rollback of a broken release with post-deploy data kept; restore; emergency stop ending the builder task.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$W = $env:GITHUB_WORKSPACE
$node = (Get-Command node).Source
$local = [Environment]::GetFolderPath("LocalApplicationData")
$live = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "orbit"
$sup = "C:\ProgramData\orbit-supervisor"; $drill = "C:\orbit-drill"; $origin = "$drill\origin.git"
$data = Join-Path $local "orbit"
$out = Join-Path $W "selfdev-windows"; New-Item -ItemType Directory -Force $out | Out-Null
$results = [System.Collections.Generic.List[string]]::new()
function Check([bool]$ok, [string]$what) { $l = "$(if ($ok) { 'ok  ' } else { 'FAIL' }) $what"; Write-Host $l; $results.Add($l) }
function Step([string]$s) { Write-Host "`n== $s"; $results.Add("== $s") }
# A fresh connection per probe (5.1 won't take a Connection header; -DisableKeepAlive is its way).
function Health { try { Invoke-RestMethod "http://127.0.0.1:3000/api/health" -TimeoutSec 5 -DisableKeepAlive } catch { $null } }
function Status { Get-Content "$sup\public\status.json" -Raw | ConvertFrom-Json }
function SupCli([string[]]$a) { $env:ORBIT_SUPERVISOR_HOME = $sup; $ErrorActionPreference = "Continue"; & $node --no-warnings --experimental-strip-types "$sup\app\supervisor.ts" @a 2>&1 }
function WaitFor([scriptblock]$cond, [int]$sec, [string]$what) {
  $d = (Get-Date).AddSeconds($sec); while ((Get-Date) -lt $d) { if (& $cond) { return $true }; Start-Sleep 3 }; Write-Host "timed out waiting for: $what"; return $false
}
function Get-Release([string]$id) { (Status).history | Where-Object { $_.id -eq $id } | Select-Object -First 1 }
function Run-Git([string[]]$a) { & git.exe -c safe.directory=* @a; if ($LASTEXITCODE) { throw "git $($a -join ' ') failed" } }

# Run a .cmd as another account through a one-off S4U task (the same logon the real tasks use). Returns the exit code.
function Invoke-As([string]$user, [string]$cmd, [int]$sec = 1800) {
  $n = "ORBIT CI $user $(Get-Random)"
  Register-ScheduledTask -TaskName $n -Force -Action (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"") `
    -User $user -Password $script:pw -RunLevel Limited -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 40)) | Out-Null
  Start-ScheduledTask -TaskName $n; Start-Sleep 3
  $null = WaitFor { (Get-ScheduledTask -TaskName $n).State -notin "Running", "Queued" } $sec "task $n"
  $r = (Get-ScheduledTaskInfo -TaskName $n).LastTaskResult
  Unregister-ScheduledTask -TaskName $n -Confirm:$false
  return $r
}

# A submission like the builder makes: commit in a work clone, bundle base..HEAD, JSON in the inbox.
$work = "$drill\work"
function Submit([string]$id, [string]$title) {
  $base = (& git -c safe.directory=* -C $work rev-parse HEAD~1).Trim(); $head = (& git -c safe.directory=* -C $work rev-parse HEAD).Trim()
  Run-Git @("-C", $work, "bundle", "create", "-q", "$sup\inbox\$id.bundle", "$base..HEAD")
  @{ id = $id; taskId = "ci:$id"; branch = "selfdev/$id"; source = "bundle"; commit = $head; base = $base; title = $title; why = "windows ci"; acceptance = @(); checks = @(@{ name = "ci"; ok = $true }); costUsd = 0 } |
    ConvertTo-Json -Depth 4 | Set-Content "$sup\inbox\$id.json.tmp" -Encoding UTF8
  Move-Item "$sup\inbox\$id.json.tmp" "$sup\inbox\$id.json"
  return $head
}
function Commit([string]$msg) { Run-Git @("-C", $work, "-c", "user.name=ci", "-c", "user.email=ci@x", "commit", "-qam", $msg) }

try {
  Step "live ORBIT checkout in the owner's Documents"
  Run-Git @("clone", "-q", $W, $live)
  Step "installer"
  $script:pw = "Ci-" + [guid]::NewGuid().ToString("N").Substring(0, 16) + "!"
  # (net user asks Y/N for passwords over 14 characters, which hangs a non-interactive run)
  @($pw, $pw) | Set-Content "$env:TEMP\orbit-ci-pw.txt" # same throwaway password for both; deleted with the VM
  foreach ($u in "orbit-builder", "orbit-build") { New-LocalUser -Name $u -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires -AccountNeverExpires | Out-Null }
  Check ([bool](Get-LocalUser orbit-builder -ErrorAction SilentlyContinue) -and [bool](Get-LocalUser orbit-build -ErrorAction SilentlyContinue)) "builder and build accounts created (standard users)"
  $ip = Start-Process powershell -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$out\install.log" -RedirectStandardError "$out\install-err.log" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$live\supervisor\windows\install.ps1", "-Live", $live, "-OwnerLogon", "S4U", "-PasswordFile", "$env:TEMP\orbit-ci-pw.txt"
  Get-Content "$out\install-err.log" -ErrorAction SilentlyContinue | Select-Object -First 15 | ForEach-Object { Write-Host "  install: $_" }
  Check ($ip.ExitCode -eq 0 -and (Test-Path "$sup\app\supervisor.ts")) "install.ps1 completed"
  foreach ($t in "ORBIT Supervisor", "ORBIT App", "ORBIT Release Build", "ORBIT Release Install", "ORBIT Builder") { Check ([bool](Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue)) "task '$t' registered" }
  Check ((Get-ScheduledTask -TaskName "ORBIT Builder").State -eq "Disabled") "builder task installed disabled"
  Check (((Get-Content "$sup\config.json" -Raw) | ConvertFrom-Json).enabled -eq $false) "installed config has unattended releases off"
  icacls $sup | Out-File "$out\acl-sup.txt"; icacls "$sup\inbox" | Out-File "$out\acl-inbox.txt"; icacls C:\orbit-stage | Out-File "$out\acl-stage.txt"

  Step "live ORBIT (isolated) build"
  @("ORBIT_ISOLATED=1", "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9", "NEXT_PUBLIC_SUPABASE_ANON_KEY=isolated", "ORBIT_DATA_DIR=$data", "NEXT_TELEMETRY_DISABLED=1") | Set-Content "$live\.env.local"
  New-Item -ItemType Directory -Force $data | Out-Null
  Push-Location $live; cmd /c "npm ci --no-audit --no-fund > `"$out\live-npm-ci.log`" 2>&1"; cmd /c "npm run build > `"$out\live-build.log`" 2>&1"; $b = $LASTEXITCODE; Pop-Location
  Check ($b -eq 0) "baseline build"

  Step "drill wiring (CI only: local origin, no GitHub, releases enabled for this drill)"
  New-Item -ItemType Directory -Force $drill | Out-Null
  icacls $drill /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
  Run-Git @("clone", "-q", "--bare", $live, $origin)
  Run-Git @("-C", $origin, "update-ref", "refs/heads/main", (& git -c safe.directory=* -C $live rev-parse HEAD).Trim()); Run-Git @("-C", $origin, "symbolic-ref", "HEAD", "refs/heads/main")
  Run-Git @("clone", "-q", $origin, $work)
  $c = Get-Content "$sup\config.json" -Raw | ConvertFrom-Json
  $c.repoUrl = $origin; $c.github = $null; $c.enabled = $true
  $c | Add-Member -Force allowWithoutExternalChecks $true
  $c.workflowChecks = @(@{ name = "sign-in page"; url = "http://127.0.0.1:3000/login"; expect = 200 }, @{ name = "public demo"; url = "http://127.0.0.1:3000/demo"; expect = 200 })
  $c.monitor = @{ probes = 3; intervalSec = 5; maxErrors = 0; startupTimeoutSec = 300 }; $c.pollSec = 3
  $c | ConvertTo-Json -Depth 6 | Set-Content "$sup\config.json" -Encoding UTF8
  '{"on":false,"at":""}' | Set-Content "$data\stop-all.json"
  Start-ScheduledTask -TaskName "ORBIT App"
  Check (WaitFor { (Health).ok } 300 "ORBIT healthy") "ORBIT App task starts the live app"
  SupCli @("adopt") *> "$out\adopt.log"
  Check ((Status).released.commit -eq (& git -c safe.directory=* -C $live rev-parse HEAD).Trim()) "baseline adopted"
  Start-ScheduledTask -TaskName "ORBIT Supervisor"
  $null = WaitFor { Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*supervisor.ts*watch*" } } 60 "supervisor process"
  $supPid = (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*supervisor.ts*watch*" } | Select-Object -First 1).ProcessId
  Check ([bool]$supPid) "supervisor runs as a SYSTEM task"
  '{}' | Set-Content "$sup\inbox\existing-by-supervisor.keep"

  Step "boundary: orbit-builder, probe run as a test from its clone of the mirror"
  $bp = "C:\orbit-builder\probe"; New-Item -ItemType Directory -Force $bp | Out-Null
  Copy-Item "$live\supervisor\boundary-probe.mjs" $bp
  "[safe]`n`tdirectory = C:/ProgramData/orbit-supervisor/mirror.git" | Set-Content "C:\orbit-builder\gitconfig"
  @"
@echo off
set GIT_CONFIG_GLOBAL=C:\orbit-builder\gitconfig
git clone -q C:\ProgramData\orbit-supervisor\mirror.git C:\orbit-builder\repo > $bp\clone.txt 2>&1
cd /d C:\orbit-builder\repo
set PROBE_ROLE=builder& set PROBE_OWN=$bp& set PROBE_SUP=$sup& set PROBE_LIVE=$live& set PROBE_STAGE=C:\orbit-stage& set PROBE_DATA=$data& set PROBE_SUP_PID=$supPid& set PROBE_ORIGIN=$origin
"$node" --test $bp\boundary-probe.mjs > $bp\out.txt 2>&1
"@ | Set-Content "$bp\run.cmd" -Encoding ASCII
$r = Invoke-As "orbit-builder" "$bp\run.cmd" 300
Copy-Item "$bp\out.txt", "$bp\clone.txt" $out -ErrorAction SilentlyContinue
$t = Get-Content "$bp\out.txt" -Raw -ErrorAction SilentlyContinue
Check ($t -match "# fail 0" -and $t -match "# pass [1-9]") "builder probe: every forbidden action refused (see probe out.txt)"
Check (Test-Path "C:\orbit-builder\repo\.git") "builder reads main from the SYSTEM-owned mirror"

  Step "boundary: orbit-build, probe run directly"
  $pp = "C:\orbit-build-cache\probe"; New-Item -ItemType Directory -Force "$pp\pkg" | Out-Null
  Copy-Item "$live\supervisor\boundary-probe.mjs" $pp; Copy-Item "$live\supervisor\boundary-probe.mjs" "$pp\pkg"
  $penv = "set PROBE_ROLE=build& set PROBE_OWN=$pp& set PROBE_SUP=$sup& set PROBE_LIVE=$live& set PROBE_STAGE=C:\orbit-stage& set PROBE_DATA=$data& set PROBE_SUP_PID=$supPid& set PROBE_ORIGIN=$origin"
  "@echo off`r`n$penv`r`n`"$node`" $pp\boundary-probe.mjs --report $pp\direct.json > $pp\direct.txt 2>&1" | Set-Content "$pp\direct.cmd" -Encoding ASCII
  $null = Invoke-As "orbit-build" "$pp\direct.cmd" 300
  $j = Get-Content "$pp\direct.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; Copy-Item "$pp\direct.*" $out -ErrorAction SilentlyContinue
  Check ($j -and $j.pass) "build account probe: every forbidden action refused"

  Step "release A through the real pipeline; its page runs the probe during next build (as orbit-build)"
  $envJs = (@{ PROBE_ROLE = "build"; PROBE_OWN = $pp; PROBE_SUP = $sup; PROBE_LIVE = $live; PROBE_STAGE = "C:\orbit-stage"; PROBE_DATA = $data; PROBE_SUP_PID = "$supPid"; PROBE_ORIGIN = $origin } | ConvertTo-Json -Compress)
  New-Item -ItemType Directory -Force "$work\src\app\selfdev-probe" | Out-Null
  @"
// Windows CI drill: runs the boundary probe while next build prerenders this page in the release stage (as orbit-build).
import { spawnSync } from "node:child_process";
export const dynamic = "force-static";
export default function Probe() {
  if (process.cwd().toLowerCase() === "c:\\orbit-stage") spawnSync(process.execPath, ["supervisor/boundary-probe.mjs", "--report", "C:\\orbit-build-cache\\probe\\build.json"], { env: { ...process.env, ...$envJs } });
  return <p>probe</p>;
}
"@ | Set-Content "$work\src\app\selfdev-probe\page.tsx" -Encoding UTF8
  Run-Git @("-C", $work, "add", "-A"); Commit "CI: build-time boundary probe page"
  $A = Submit "ci-a" "CI: probe page"
  $null = WaitFor { (Get-Release "ci-a") } 3600 "release A"
  Check ((Get-Release "ci-a").step -eq "retained") "release A built by orbit-build, installed by the owner task, verified, kept ($((Get-Release 'ci-a').reason))"
  Check ((Health).commit -eq $A) "live runs release A"
  $j = Get-Content "$pp\build.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; Copy-Item "$pp\build.json" $out -ErrorAction SilentlyContinue
  Check ($j -and $j.pass) "probe during next build: every forbidden action refused"
  Check (-not (Get-CimInstance Win32_Process | Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue).User -eq "orbit-build" })) "no orbit-build process left after the build"

  Step "dependency install script as orbit-build"
  '{"name":"orbit-probe-pkg","version":"1.0.0","scripts":{"postinstall":"node boundary-probe.mjs --report ..\\install.json"}}' | Set-Content "$pp\pkg\package.json" -Encoding ASCII
  "@echo off`r`n$penv`r`ncd /d C:\orbit-stage`r`nnpm install --no-save --no-audit --no-fund $pp\pkg > $pp\install.txt 2>&1" | Set-Content "$pp\install.cmd" -Encoding ASCII
  $null = Invoke-As "orbit-build" "$pp\install.cmd" 900
  $j = Get-Content "$pp\install.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json; Copy-Item "$pp\install.*" $out -ErrorAction SilentlyContinue
  Check ($j -and $j.pass) "probe in a postinstall script: every forbidden action refused"

  Step "ORBIT Stop-all holds a release"
  Add-Content "$work\docs\RECOVERY.md" "`nWindows CI release B."; Commit "CI: docs-only release B"
  '{"on":true,"at":"ci"}' | Set-Content "$data\stop-all.json"
  $B = Submit "ci-b" "CI: docs-only release B"; Start-Sleep 20
  Check ((Status).blocked -eq "ORBIT Stop-all is on" -and (Test-Path "$sup\inbox\ci-b.json")) "release held while Stop-all is on"
  Set-Content "$data\stop-all.json" ""; Start-Sleep 10
  Check ((Status).blocked -eq "ORBIT Stop-all is on") "a damaged stop-all.json also holds it"

  Step "a locked file in the live build during install"
  $lock = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "`$f=[IO.File]::Open('$live\.next\BUILD_ID','Open','Read','None'); Start-Sleep 7200"
  Start-Sleep 3
  Remove-Item "$data\stop-all.json"
  $null = WaitFor { (Get-Release "ci-b") } 3600 "release B"
  $h = Get-Release "ci-b"; Write-Host "release B: $($h.step) $($h.reason)"
  Check ($h.step -in "halted", "rolledBack") "install with a locked file fails and halts releases ($($h.reason))"
  # Each failed attempt stopped ORBIT and restarted it on A through the launcher; allow it the launcher's start time.
  Check (WaitFor { $h2 = Health; $h2.ok -and $h2.commit -eq $A } 180 "ORBIT back on A") "ORBIT runs release A again after the failed swap (within 3 min)"
  Check (Test-Path "$live\.next\BUILD_ID") "the live build wasn't half-deleted"
  Stop-Process -Id $lock.Id -Force -ErrorAction SilentlyContinue
  Set-Content "$sup\ctl\control-1-restore.json" (@{ action = "restore"; releaseId = "ci-a" } | ConvertTo-Json)
  $null = WaitFor { (Get-Content "$sup\audit.jsonl" -Raw) -match '"restore\.(verified|failed)"' } 900 "restore"
  Check ((Get-Content "$sup\audit.jsonl" -Raw) -match '"restore\.verified"') "owner restore to A after the lock is gone"
  Check ((& git -c safe.directory=* -C $origin rev-parse "main^{tree}").Trim() -eq (& git -c safe.directory=* -C $origin rev-parse "$A^{tree}").Trim()) "main back on release A's code"
  Set-Content "$sup\ctl\control-2-clear.json" '{"action":"clear"}'; Start-Sleep 10
  Check (-not (Status).halted -and -not (Status).paused) "owner clear (ctl) lifts the halt"

  Step "a broken release is rolled back; data it wrote is kept and listed"
  Run-Git @("-C", $work, "fetch", "-q", $origin, "main"); Run-Git @("-C", $work, "reset", "-q", "--hard", "FETCH_HEAD")
  $p = "$work\src\app\demo\page.tsx"
  (Get-Content $p -Raw).Replace('export const dynamic = "force-static";', 'export const dynamic = "force-dynamic";').Replace('  const data = demoData();', '  if (process.env.ORBIT_DRILL_OK !== "1") { require("node:fs").writeFileSync(process.env.ORBIT_DATA_DIR + "/written-after-deploy.json", "{}"); throw new Error("ci: broken page"); } const data = demoData();') | Set-Content $p -Encoding UTF8
  Commit "CI: broken demo page"
  $C = Submit "ci-c" "CI: broken demo page"
  $null = WaitFor { (Get-Release "ci-c") } 3600 "release C"
  $h = Get-Release "ci-c"
  Check ($h.step -eq "rolledBack") "broken release rolled back ($($h.reason))"
  Check ((Health).ok -and (Health).commit -eq $A) "release A restored and healthy"
  Check ((& git -c safe.directory=* -C $origin rev-parse "main^{tree}").Trim() -eq (& git -c safe.directory=* -C $origin rev-parse "$A^{tree}").Trim()) "main reverted"
  Check ((Test-Path "$data\written-after-deploy.json") -and ((Get-Content "$sup\audit.jsonl" -Raw) -match 'rollback\.data[^\n]*written-after-deploy')) "data written after deployment kept and listed"

  Step "emergency stop from ORBIT ends the builder task"
  Set-ScheduledTask -TaskName "ORBIT Builder" -User "orbit-builder" -Password $pw -Action (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -Command Start-Sleep 1800") | Out-Null
  Enable-ScheduledTask -TaskName "ORBIT Builder" | Out-Null; Start-ScheduledTask -TaskName "ORBIT Builder"; Start-Sleep 5
  Check ((Get-ScheduledTask -TaskName "ORBIT Builder").State -eq "Running") "builder task running (as orbit-builder) before the stop"
  '{"action":"stop"}' | Set-Content "$sup\inbox\control-9-stop.json"
  Check (WaitFor { (Get-ScheduledTask -TaskName "ORBIT Builder").State -ne "Running" } 60 "builder stopped") "emergency stop ended the builder task"
  Check ((Test-Path "$sup\STOP") -and (Status).stopped) "supervisor emergency stop on"
  Disable-ScheduledTask -TaskName "ORBIT Builder" | Out-Null
  SupCli @("verify-audit") *> "$out\verify-audit.txt"
  Check ((Get-Content "$out\verify-audit.txt" -Raw) -match "intact") "audit chain intact"
} catch {
  Check $false "script error: $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  foreach ($f in "status.json") { Copy-Item "$sup\public\$f" $out -ErrorAction SilentlyContinue }
  Copy-Item "$sup\audit.jsonl", "$sup\supervisor.log" $out -ErrorAction SilentlyContinue
  Copy-Item "C:\orbit-build-cache\release-build.log", "$live\orbit-server.log", "$live\orbit-launcher.log", "$live\orbit-build.log" $out -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $local "orbit-install\INSTALL_RESULT.txt") $out -ErrorAction SilentlyContinue
  $results | Set-Content "$out\results.txt"
  if ($env:GITHUB_STEP_SUMMARY) { "### Self-dev Windows checks`n``````" + "`n" + ($results -join "`n") + "`n``````" | Add-Content $env:GITHUB_STEP_SUMMARY }
}
$failed = @($results | Where-Object { $_ -like "FAIL*" }).Count
Write-Host "`n$failed failed"
exit [int]($failed -gt 0)
