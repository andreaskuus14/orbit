# Windows proof of the ORBIT test runner on a DISPOSABLE machine (GitHub Actions windows-latest). Never run on the PC: it creates
# accounts, ACLs, a firewall rule and SYSTEM tasks, and turns the machine's firewall on.
# Proves: a test the builder asks for runs as orbit-test through the SYSTEM supervisor and the "ORBIT Test Runner" task, and from
# there can't read the builder's model key or login (canaries planted), change its spending settings, read the supervisor's
# credentials or ORBIT's data, or reach the network, also from child and grandchild processes. Test commands run in an AppContainer
# with no capabilities (orbit-sandbox.exe), so they also can't reach a service on the host's loopback (a stand-in on :3000, where
# live ORBIT listens) or resolve names: the Windows DNS Client log must show no query for the probe's marker name.
# Controls: with the firewall rule off the sandbox alone still refuses everything; outside the sandbox the same probe reaches the
# internet, the host service and DNS, and its marker name does appear in the DNS log. A real ORBIT test passes. No model, no secrets.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$W = $env:GITHUB_WORKSPACE
$node = (Get-Command node).Source
$live = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "orbit"
$sup = "C:\ProgramData\orbit-supervisor"; $T = "C:\orbit-test"; $bh = "C:\orbit-builder"; $origin = "C:\orbit-drill\origin.git"
$data = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "orbit"
$out = Join-Path $W "selfdev-test-runner"; New-Item -ItemType Directory -Force $out | Out-Null
$results = [System.Collections.Generic.List[string]]::new()
function Check([bool]$ok, [string]$what) { $l = "$(if ($ok) { 'ok  ' } else { 'FAIL' }) $what"; Write-Host $l; $results.Add($l) }
function Note([string]$what) { $l = "note $what"; Write-Host $l; $results.Add($l) }
function Step([string]$s) { Write-Host "`n== $s"; $results.Add("== $s") }
function WaitFor([scriptblock]$cond, [int]$sec, [string]$what) {
  $d = (Get-Date).AddSeconds($sec); while ((Get-Date) -lt $d) { if (& $cond) { return $true }; Start-Sleep 3 }; Write-Host "timed out waiting for: $what"; return $false
}
function Run-Git([string[]]$a) { & git.exe -c safe.directory=* @a; if ($LASTEXITCODE) { throw "git $($a -join ' ') failed" } }
function Invoke-As([string]$user, [string]$cmd, [int]$sec = 600, [switch]$NoWait) {
  $n = "ORBIT CI $user $(Get-Random)"
  Register-ScheduledTask -TaskName $n -Force -Action (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$cmd`"") `
    -User $user -Password $script:pw -RunLevel Limited -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 40)) | Out-Null
  Start-ScheduledTask -TaskName $n; Start-Sleep 3
  if ($NoWait) { return $n }
  $null = WaitFor { (Get-ScheduledTask -TaskName $n).State -notin "Running", "Queued" } $sec "task $n"
  $r = (Get-ScheduledTaskInfo -TaskName $n).LastTaskResult
  Unregister-ScheduledTask -TaskName $n -Confirm:$false
  return $r
}
function Owned([string]$user) { @(Get-CimInstance Win32_Process | Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue).User -eq $user }) }

try {
  Step "accounts and installers"
  Run-Git @("clone", "-q", $W, $live)
  $script:pw = "Ci-" + [guid]::NewGuid().ToString("N").Substring(0, 16) + "!"
  @($pw, $pw) | Set-Content "$env:TEMP\orbit-ci-pw.txt"; $pw | Set-Content "$env:TEMP\orbit-ci-pw-test.txt"
  foreach ($u in "orbit-builder", "orbit-build", "orbit-test") { New-LocalUser -Name $u -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires -AccountNeverExpires | Out-Null }
  $ip = Start-Process powershell -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$out\install.log" -RedirectStandardError "$out\install-err.log" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$live\supervisor\windows\install.ps1", "-Live", $live, "-OwnerLogon", "S4U", "-PasswordFile", "$env:TEMP\orbit-ci-pw.txt"
  Check ($ip.ExitCode -eq 0 -and (Test-Path "$sup\app\test-run.ts")) "install.ps1 completed (test-run.ts installed with the supervisor)"
  # The builder's dependency tree: here an empty one (the probe and the real test below need none); on the PC, npm ci in its repo.
  New-Item -ItemType Directory -Force "$bh\repo-deps\node_modules" | Out-Null
  Set-NetFirewallProfile -All -Enabled True # disposable VM only: the runner's rule needs the firewall on
  $it = Start-Process powershell -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$out\install-test-runner.log" -RedirectStandardError "$out\install-test-runner-err.log" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$live\supervisor\windows\install-test-runner.ps1", "-Modules", "$bh\repo-deps\node_modules", "-PasswordFile", "$env:TEMP\orbit-ci-pw-test.txt"
  Get-Content "$out\install-test-runner-err.log" -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Write-Host "  install-test-runner: $_" }
  Check ($it.ExitCode -eq 0 -and [bool](Get-ScheduledTask -TaskName "ORBIT Test Runner" -ErrorAction SilentlyContinue)) "install-test-runner.ps1 completed; task 'ORBIT Test Runner' registered"
  $tr = Get-ScheduledTask -TaskName "ORBIT Test Runner"
  Check ($tr.Principal.UserId -match "orbit-test$" -and $tr.Principal.RunLevel -eq "Limited") "the task runs as orbit-test, limited"
  Check (-not (Get-LocalGroupMember -Group Administrators | Where-Object { $_.Name -match "\\orbit-test$" })) "orbit-test is not an administrator"
  $fw = Get-NetFirewallRule -DisplayName "ORBIT test runner: no network" -ErrorAction SilentlyContinue
  Check ($fw -and $fw.Enabled -eq "True" -and $fw.Direction -eq "Outbound" -and $fw.Action -eq "Block" -and -not (Get-NetFirewallProfile | Where-Object { -not $_.Enabled })) "outbound block rule for orbit-test present; firewall on for every profile"
  $c = Get-Content "$sup\config.json" -Raw | ConvertFrom-Json
  Check ($c.enabled -eq $false -and $c.testRunner.reqDir -eq "$T\req") "supervisor config: unattended releases off, builder tests routed to the runner"
  $acSid = if (Test-Path "$sup\app\windows\orbit-sandbox.exe") { (& "$sup\app\windows\orbit-sandbox.exe" --sid).Trim() } else { "" }
  Check ($acSid -match '^S-1-15-2-') "sandbox built: orbit-sandbox.exe, AppContainer $acSid (no capabilities)"
  foreach ($d in "$T", "$T\req", "$T\results", "$T\work", "$T\run", "$sup\app") { icacls $d | Out-File -Append "$out\acl.txt" }

  Step "drill wiring: local origin, mirror, canaries"
  New-Item -ItemType Directory -Force C:\orbit-drill | Out-Null
  icacls C:\orbit-drill /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
  Run-Git @("clone", "-q", "--bare", $live, $origin)
  Run-Git @("-C", $origin, "update-ref", "refs/heads/main", (& git -c safe.directory=* -C $live rev-parse HEAD).Trim()); Run-Git @("-C", $origin, "symbolic-ref", "HEAD", "refs/heads/main")
  $c.repoUrl = $origin; $c.github = $null; $c.pollSec = 3; $c | ConvertTo-Json -Depth 6 | Set-Content "$sup\config.json" -Encoding UTF8
  New-Item -ItemType Directory -Force $data | Out-Null; '{"on":false,"at":""}' | Set-Content "$data\stop-all.json"; '{"secret":"orbit data"}' | Set-Content "$data\store.json"
  Start-ScheduledTask -TaskName "ORBIT Supervisor"
  Check (WaitFor { Test-Path "$sup\mirror.git\HEAD" } 180 "mirror") "the SYSTEM supervisor runs and fills the mirror"
  $supPid = (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*supervisor.ts*watch*" } | Select-Object -First 1).ProcessId
  # Canary credentials and spending settings where the builder keeps them; a builder process holding the key in its environment.
  $canary = "sk-ant-canary-" + [guid]::NewGuid().ToString("N")
  New-Item -ItemType Directory -Force "$bh\secrets", "$bh\worktrees" | Out-Null
  $canary | Set-Content "$bh\secrets\model.key"; '{"maxUsdPerTask":3,"maxUsdPerDay":6}' | Set-Content "$bh\config.json"; '{"day":{"day":"x","costUsd":5.5}}' | Set-Content "$bh\state.json"
  "builder log" | Set-Content "$bh\builder.log"
  $hold = "@echo off`r`nset ANTHROPIC_API_KEY=$canary`r`nset CLAUDE_CODE_OAUTH_TOKEN=$canary`r`npowershell -NoProfile -Command Start-Sleep 1800"
  $hold | Set-Content "$bh\hold.cmd" -Encoding ASCII
  $holdTask = Invoke-As "orbit-builder" "$bh\hold.cmd" -NoWait
  $null = WaitFor { Owned "orbit-builder" | Where-Object { $_.Name -eq "powershell.exe" } } 60 "builder process"
  $bPid = (Owned "orbit-builder" | Where-Object { $_.Name -eq "powershell.exe" } | Select-Object -First 1).ProcessId
  $prof = (Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -match "\\orbit-builder" } | Select-Object -First 1).LocalPath
  if ($prof) { New-Item -ItemType Directory -Force "$prof\.claude" | Out-Null; "{`"claudeAiOauth`":{`"accessToken`":`"$canary`"}}" | Set-Content "$prof\.claude\.credentials.json" }
  Check ([bool]$bPid -and [bool]$prof) "builder process holds a canary key (pid $bPid); canary login in its profile ($prof)"
  $sums = (Get-FileHash "$bh\config.json", "$bh\state.json").Hash -join ","
  # A stand-in for live ORBIT on the host's loopback, port 3000, IPv4 and IPv6.
  $hostListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 3000); $hostListener.Start()
  $hostListener6 = [Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Loopback, 3000); $hostListener6.Start()
  # The DNS Client log records every name lookup handed to the system resolver: the evidence that no query was triggered.
  wevtutil sl Microsoft-Windows-DNS-Client/Operational /e:true
  function DnsSeen([string]$n) { [bool](Get-WinEvent -LogName "Microsoft-Windows-DNS-Client/Operational" -ErrorAction SilentlyContinue | Where-Object { $_.Message -match [regex]::Escape($n) }) }
  $marker = "orbit-probe-" + [guid]::NewGuid().ToString("N").Substring(0, 12) + ".example.com"

  Step "requests from the builder account (what builder.ts runTests does)"
  "[safe]`n`tdirectory = *" | Set-Content "$bh\gitconfig"
  $penv = @{ PROBE_ROLE = "test"; PROBE_SUP = $sup; PROBE_LIVE = $live; PROBE_STAGE = "C:\orbit-stage"; PROBE_DATA = $data; PROBE_OWN = "$T\results"; PROBE_SUP_PID = "$supPid"
    PROBE_ORIGIN = $origin; PROBE_BUILDER = $bh; PROBE_BUILDER_PROFILE = "$prof"; PROBE_BUILDER_PID = "$bPid"; PROBE_HOST_PORT = "3000"; PROBE_DNS_NAME = $marker } | ConvertTo-Json -Compress
  $penv | Set-Content "$bh\probe-env.json" -Encoding ASCII
  Copy-Item "$live\supervisor\boundary-probe.mjs" "$bh\zz-boundary.test.ts"
  # request.cjs <id> <kind> <files json> <mode: probe|plain>: commit in the builder's clone, bundle against main, one write each into req\
  @'
const { execFileSync } = require("child_process"), fs = require("fs"), path = require("path");
const [id, kind, files, mode] = process.argv.slice(2), repo = "C:\\orbit-builder\\repo", req = "C:\\orbit-test\\req";
const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "C:\\orbit-builder\\gitconfig" } }).trim();
if (!fs.existsSync(path.join(repo, ".git"))) execFileSync("git", ["clone", "-q", "C:\\ProgramData\\orbit-supervisor\\mirror.git", repo], { env: { ...process.env, GIT_CONFIG_GLOBAL: "C:\\orbit-builder\\gitconfig" } });
if (mode === "probe") { fs.copyFileSync("C:\\orbit-builder\\zz-boundary.test.ts", path.join(repo, "tests", "zz-boundary.test.ts")); fs.copyFileSync("C:\\orbit-builder\\probe-env.json", path.join(repo, "probe-env.json")); }
else { for (const f of ["tests/zz-boundary.test.ts", "probe-env.json"]) fs.rmSync(path.join(repo, f), { force: true }); }
g("add", "-A"); try { g("-c", "user.name=b", "-c", "user.email=b@x", "commit", "-qm", `request ${id}`); } catch { /* nothing new */ }
const commit = g("rev-parse", "HEAD"), base = g("rev-parse", "origin/HEAD");
if (commit !== base) {
  g("update-ref", `refs/selfdev-test/${id}`, commit);
  const own = `C:\\orbit-builder\\${id}.bundle`; g("bundle", "create", "-q", own, `refs/selfdev-test/${id}`, `^${base}`);
  fs.copyFileSync(own, path.join(req, `${id}.bundle`), fs.constants.COPYFILE_EXCL); fs.rmSync(own);
}
fs.writeFileSync(path.join(req, `${id}.json`), JSON.stringify({ id, task: "probe-task", commit, base, kind, files: JSON.parse(files) }), { flag: "wx" });
'@ | Set-Content "$bh\request.cjs" -Encoding ASCII
  function Request([string]$id, [string]$kind, [string]$files, [string]$mode) {
    "@echo off`r`n`"$node`" C:\orbit-builder\request.cjs $id $kind `"$($files -replace '"','\"')`" $mode > C:\orbit-builder\req-$id.txt 2>&1" | Set-Content "$bh\req-$id.cmd" -Encoding ASCII
    $r = Invoke-As "orbit-builder" "$bh\req-$id.cmd" 300
    Copy-Item "$bh\req-$id.txt" $out -ErrorAction SilentlyContinue
    if (-not (Test-Path "$T\req\$id.json") -and -not (Test-Path "$T\results\$id.json")) { Write-Host (Get-Content "$bh\req-$id.txt" -Raw -ErrorAction SilentlyContinue); throw "builder couldn't file request $id (task result $r)" }
    $null = WaitFor { Test-Path "$T\results\$id.json" } 900 "result $id"
    Start-Sleep 2; Copy-Item "$T\results\$id.json" $out -ErrorAction SilentlyContinue
    return (Get-Content "$T\results\$id.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json)
  }
  # Diagnostics: the sandbox itself, as orbit-test, before the real requests (each step bounded, output kept as evidence).
  $sbx = "$sup\app\windows\orbit-sandbox.exe"
  "@echo off`r`n`"$sbx`" --cwd C:\orbit-test\work -- `"$node`" -e `"console.log('sandbox-hello')`" > C:\orbit-test\results\diag-hello.txt 2>&1`r`necho exit %ERRORLEVEL% >> C:\orbit-test\results\diag-hello.txt" | Set-Content "$T\run\diag.cmd" -Encoding ASCII
  $null = Invoke-As "orbit-test" "$T\run\diag.cmd" 120
  $diag = Get-Content "$T\results\diag-hello.txt" -Raw -ErrorAction SilentlyContinue; $diag | Set-Content "$out\diag-hello.txt"
  Check ($diag -match "sandbox-hello") "node starts and prints inside the AppContainer ($(($diag -replace '\s+',' ').Trim()))"
  $p = Request "probe-1" "focused" '["tests/zz-boundary.test.ts"]' "probe"
  $tail = ($p.steps | ForEach-Object { $_.tail }) -join "`n"; $tail | Set-Content "$out\probe-1-tail.txt"
  foreach ($l in ($tail -split "`n" | Where-Object { $_ -match '^\s*(ok|not ok) \d|# (pass|fail)|# report:|could |can.t ' })) { Write-Host "    $($l.Trim())" }
  Check ($p.user -eq "orbit-test") "the test ran as orbit-test (result says '$($p.user)')"
  Check ($p.ok -eq $true -and $tail -match "# fail 0" -and $tail -match "# pass [1-9]") "probe as a model-written test: builder key, login and spending settings, supervisor credentials, ORBIT data, the internet (itself, child, grandchild), DNS and the host's :3000 (IPv4, IPv6, localhost) all refused"
  Check (($p.steps | ForEach-Object { $_.name }) -join " " -match "AppContainer") "the test command ran inside the AppContainer"
  Start-Sleep 5
  Check (-not (DnsSeen $marker)) "no DNS query for the probe's marker name reached the DNS Client ($marker)"
  foreach ($l in ($tail -split "`n" | Where-Object { $_ -match '# report:' })) { Note "$($l.Trim() -replace '^#\s*\\?#?\s*report: ','')" }

  Step "controls: the sandbox alone, and the same probe outside the sandbox"
  Disable-NetFirewallRule -DisplayName "ORBIT test runner: no network"
  try {
    $n = Request "probe-2" "focused" '["tests/zz-boundary.test.ts"]' "probe"
    $ntail = ($n.steps | ForEach-Object { $_.tail }) -join "`n"; $ntail | Set-Content "$out\probe-2-tail.txt"
    Check ($n.ok -eq $true -and $ntail -match "# fail 0") "firewall rule off: the AppContainer alone still refuses the internet, DNS and the host's :3000"
    # Outside the sandbox (orbit-test, rule off): the probe must see what the sandbox hides, and the DNS log must catch its lookup.
    $ctlName = "orbit-control-" + [guid]::NewGuid().ToString("N").Substring(0, 12) + ".example.com"
    "@echo off`r`ncd /d C:\orbit-test\work\probe-task\repo`r`nset `"PROBE_DNS_NAME=$ctlName`"`r`n`"$node`" tests\zz-boundary.test.ts --report C:\orbit-test\results\control.json > C:\orbit-test\results\control.log 2>&1" | Set-Content "$T\run\control.cmd" -Encoding ASCII
    $null = Invoke-As "orbit-test" "$T\run\control.cmd" 300
    Copy-Item "$T\results\control.json", "$T\results\control.log" $out -ErrorAction SilentlyContinue
    $ctl = Get-Content "$T\results\control.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
    $got = { param($re) [bool]($ctl.results | Where-Object { $_.what -match $re -and $_.got -eq "allowed" }) }
    Check ((& $got "connect to 1\.1\.1\.1") -and (& $got "resolve example\.com through") -and (& $got "host.s service on 127\.0\.0\.1:3000")) "outside the sandbox the same probe reaches the internet, resolves names and reaches the host's :3000, so the refusals above come from the sandbox"
    Start-Sleep 5
    Check (DnsSeen $ctlName) "outside the sandbox its lookup appears in the DNS Client log, so the log check above can see a query"
  } finally { Enable-NetFirewallRule -DisplayName "ORBIT test runner: no network" }

  Step "the runner is usable, not just closed"
  $real = Request "real-1" "focused" '["tests/supervisor-policy.test.ts"]' "plain"
  $rt = ($real.steps | ForEach-Object { $_.tail }) -join "`n"
  Check ($real.ok -eq $true -and $rt -match "# pass [1-9]" -and $real.user -eq "orbit-test") "a real ORBIT test passes as orbit-test"
  '{"id":"bad-1","task":"probe-task","commit":"' + ("a" * 40) + '","base":"' + ("b" * 40) + '","kind":"shell","files":[]}' | Set-Content "$T\req\bad-1.json" -Encoding ASCII
  Check (WaitFor { (Get-Content "$T\results\bad-1.json" -Raw -ErrorAction SilentlyContinue) -match "refused: bad kind" } 120 "bad-1") "a request outside the fixed kinds is refused by the supervisor"

  Step "afterwards"
  $hit = Get-ChildItem $T -Recurse -File -ErrorAction SilentlyContinue | Select-String -SimpleMatch $canary -List -ErrorAction SilentlyContinue
  $hitLog = Select-String -Path "$sup\supervisor.log", "$sup\audit.jsonl" -SimpleMatch $canary -List -ErrorAction SilentlyContinue
  Check (-not $hit -and -not $hitLog) "canary absent from every result, work file and supervisor log ($(@($hit).Count + @($hitLog).Count) hits)"
  Check (((Get-FileHash "$bh\config.json", "$bh\state.json").Hash -join ",") -eq $sums) "builder spending settings unchanged"
  Check ((Get-Content "$data\store.json" -Raw) -match "orbit data" -and (Get-Content "$data\stop-all.json" -Raw) -match '"on":false') "ORBIT data and Stop-all unchanged"
  Check (WaitFor { -not (Owned "orbit-test") } 30 "orbit-test processes gone") "no orbit-test process left after the runs"
  $au = Get-Content "$sup\audit.jsonl" -Raw
  Check ([regex]::Matches($au, '"test\.run"').Count -ge 3 -and $au -match '"test\.refused"') "the supervisor audited each run and the refusal"
} catch {
  Check $false "script error: $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
} finally {
  if ($hostListener) { $hostListener.Stop() }; if ($hostListener6) { $hostListener6.Stop() }
  if ($holdTask) { Stop-ScheduledTask -TaskName $holdTask -ErrorAction SilentlyContinue }
  Copy-Item "$sup\supervisor.log", "$sup\audit.jsonl", "$sup\config.json", "$T\work\last-run.log" $out -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName "ORBIT test runner: no network" -ErrorAction SilentlyContinue | Format-List * | Out-File "$out\firewall-rule.txt"
  $results | Set-Content "$out\results.txt"
}
$failed = @($results | Where-Object { $_ -like "FAIL*" }).Count
Write-Host "`n$failed failed"
exit $(if ($failed) { 1 } else { 0 })
