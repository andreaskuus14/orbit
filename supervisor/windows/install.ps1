# Installs the ORBIT release supervisor and the self-development builder on the Windows PC.
# Run once, from an ELEVATED PowerShell in the ORBIT folder:   powershell -ExecutionPolicy Bypass -File supervisor\windows\install.ps1
# UNTESTED ON WINDOWS so far (written and drilled on Linux); check each step's output the first time.
#
# Trust boundary it sets up:
#   C:\ProgramData\orbit-supervisor            SYSTEM + Administrators only (the supervisor's code, config, GitHub token, audit
#                                              trail, release snapshots and data backups). Unelevated processes, including ORBIT
#                                              and the builder, can't read or change it.
#     \inbox   Andreas may create files (submissions, pause/stop/restore requests); only the supervisor reads/deletes them.
#     \public  Andreas may read (status.json, diffs); only the supervisor writes.
#     \releases, \mirror.git  Andreas may read (snapshots to install, main to build on); only the supervisor writes.
#   Task "ORBIT Supervisor"     runs as SYSTEM at startup, restarts on failure. Never runs repo code, and never runs git or
#                               scripts inside the owner-writable live or stage folders (owner-context tasks do that).
#   Task "ORBIT Release Install" runs as Andreas: stops ORBIT, checks out the release, swaps in the snapshot, starts ORBIT.
#   Task "ORBIT Release Build"  runs as Andreas: builds an exact commit in %LOCALAPPDATA%\orbit-stage (repo code runs only here).
#   Task "ORBIT Builder"        runs as Andreas at logon: the builder loop, with no GitHub or Supabase credentials.
# The builder can push nothing and merge nothing. If ORBIT is broken or not answering, the supervisor still rolls back.
param([string]$Owner = $env:USERNAME, [string]$Live = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this from an elevated PowerShell." }
$node = (Get-Command node -ErrorAction Stop).Source
$home_ = "C:\ProgramData\orbit-supervisor"
$app = Join-Path $home_ "app"
$stage = Join-Path $env:LOCALAPPDATA "orbit-stage"
$bhome = Join-Path $env:LOCALAPPDATA "orbit-selfdev"

# 1. The supervisor's installed copy: changes to supervisor\ in the repo don't reach it until this script runs again.
New-Item -ItemType Directory -Force -Path $app, (Join-Path $app "windows"), (Join-Path $home_ "inbox"), (Join-Path $home_ "public") | Out-Null
Copy-Item (Join-Path $Live "supervisor\*.ts"), (Join-Path $Live "supervisor\package.json") $app -Force
Copy-Item (Join-Path $Live "supervisor\windows\*.ps1") (Join-Path $app "windows") -Force

# 2. Lock it down. /inheritance:r drops inherited rights; then SYSTEM + Administrators full, owner limited rights on two folders.
icacls $home_ /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
icacls (Join-Path $home_ "inbox") /grant "${Owner}:(OI)(CI)(WD,AD,RD,X)" | Out-Null   # create + list (he owns what he creates; the supervisor only reads plain files once)
New-Item -ItemType Directory -Force -Path (Join-Path $home_ "releases"), (Join-Path $home_ "ctl") | Out-Null
icacls (Join-Path $home_ "releases") /grant "${Owner}:(OI)(CI)RX" | Out-Null
icacls (Join-Path $home_ "mirror.git") /grant "${Owner}:(OI)(CI)RX" 2>$null | Out-Null # created on first run; run this script again after it exists
icacls (Join-Path $home_ "public") /grant "${Owner}:(OI)(CI)RX" | Out-Null

# 3. Config (edit it, then run this script again or restart the task). Token: a fine-grained GitHub token for this repo only,
#    Contents: read/write, Pull requests: read/write, Checks: read. Put it in token.txt next to config.json.
$cfgFile = Join-Path $home_ "config.json"
if (-not (Test-Path $cfgFile)) {
  @{
    repoUrl = "https://github.com/andreaskuus14/orbit.git"; mainBranch = "main"; liveDir = $Live; distDir = ".next"; stageDir = $stage
    healthUrl = "http://127.0.0.1:3000/api/health"; serverLog = (Join-Path $Live "orbit-server.log")
    commands = @{
      build = @("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $app "windows\trigger-build.ps1"), "{commit}", "{stage}")
      install = @("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $app "windows\trigger-install.ps1"), "{commit}", "{dist}", $stage)
      stop = @("cmd.exe", "/c", "exit 0"); start = @("cmd.exe", "/c", "exit 0") # unused while install is set
      stopBuilder = @("schtasks.exe", "/End", "/TN", "ORBIT Builder")
    }
    github = @{ repo = "andreaskuus14/orbit"; tokenFile = (Join-Path $home_ "token.txt"); checksTimeoutSec = 1800 }
    workflowChecks = @(@{ name = "sign-in page"; url = "http://127.0.0.1:3000/login"; expect = 200 })
    monitor = @{ probes = 10; intervalSec = 60; maxErrors = 0; startupTimeoutSec = 300 }
    dataBackup = @{ paths = @((Join-Path $env:LOCALAPPDATA "orbit")); maxBytes = 2000000000 }
    keepReleases = 5; pollSec = 30
  } | ConvertTo-Json -Depth 5 | Set-Content $cfgFile -Encoding UTF8
}

# 4. Tasks. The supervisor as SYSTEM; the app, release build and builder as the owner (interactive: they run while he's signed in).
$sup = New-ScheduledTaskAction -Execute $node -Argument "--no-warnings --experimental-strip-types `"$app\supervisor.ts`" watch" -WorkingDirectory $app
$set = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "ORBIT Supervisor" -Action $sup -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $set -Principal (New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest) -Force | Out-Null
[Environment]::SetEnvironmentVariable("ORBIT_SUPERVISOR_HOME", $home_, "Machine")
[Environment]::SetEnvironmentVariable("ORBIT_SELFDEV_HOME", $bhome, "User") # read by ORBIT's DEV view and the builder

$me = New-ScheduledTaskPrincipal -UserId $Owner -LogonType Interactive -RunLevel Limited
$appAct = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Live\scripts\launch.ps1`" -ServerOnly" -WorkingDirectory $Live
Register-ScheduledTask -TaskName "ORBIT App" -Action $appAct -Principal $me -Force | Out-Null
$buildAct = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$app\windows\release-build.ps1`" -Stage `"$stage`" -Live `"$Live`"" -WorkingDirectory $Live
Register-ScheduledTask -TaskName "ORBIT Release Build" -Action $buildAct -Principal $me -Force | Out-Null
$instAct = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$app\windows\release-install.ps1`" -Live `"$Live`" -Stage `"$stage`"" -WorkingDirectory $Live
Register-ScheduledTask -TaskName "ORBIT Release Install" -Action $instAct -Principal $me -Force | Out-Null
$bAct = New-ScheduledTaskAction -Execute $node -Argument "--no-warnings --experimental-strip-types `"$bhome\repo\selfdev\builder.ts`" run" -WorkingDirectory $bhome
Register-ScheduledTask -TaskName "ORBIT Builder" -Action $bAct -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $Owner) -Settings $set -Principal $me -Force | Out-Null
Disable-ScheduledTask -TaskName "ORBIT Builder" | Out-Null # enabled only after the drills pass on this PC (see README)

Write-Host "Installed. Next: token.txt, review config.json, then (elevated) node --experimental-strip-types `"$app\supervisor.ts`" adopt"
Write-Host "Builder: clone the repo to $bhome\repo, npm ci there, write $bhome\config.json (upstream = $home_\mirror.git; see supervisor\README.md)."
Write-Host "Before Enable-ScheduledTask 'ORBIT Builder': read 'What the protections rest on' in supervisor\README.md (separate builder account)."
