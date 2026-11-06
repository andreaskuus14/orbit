# Installs the ORBIT release supervisor, release build and self-development builder on Windows.
# Run from an ELEVATED PowerShell in the ORBIT folder:   powershell -ExecutionPolicy Bypass -File supervisor\windows\install.ps1
# Create the two standard accounts first (choose passwords; never sign in with them; no git or GitHub credentials):
#   net user orbit-builder * /add        net user orbit-build * /add
#
# Accounts and what each may touch:
#   SYSTEM          C:\ProgramData\orbit-supervisor: code, config, GitHub token, state, audit, snapshots, data backups, mirror.
#                   Runs no repo code, and no git or scripts inside anyone else's folders.
#   owner           the live install (Documents\orbit), ORBIT's data. "ORBIT Release Install": stop, swap the snapshot in, check out, start.
#   orbit-build     C:\orbit-stage + C:\orbit-build-cache only. "ORBIT Release Build": fresh clone of the mirror, npm ci (dependency
#                   install scripts run here), next build. Gets only NEXT_PUBLIC_* values; its processes are ended before the snapshot.
#   orbit-builder   C:\orbit-builder only. "ORBIT Builder": the model session, its tests and gate. Creates files in inbox\, reads public\
#                   and the mirror. Nothing else.
# Unattended releases stay off (config enabled: false) and the "ORBIT Builder" task stays disabled until the checks in
# supervisor\README.md "Enabling" pass on this machine.
param(
  [string]$Owner = $env:USERNAME, [string]$Builder = "orbit-builder", [string]$BuildUser = "orbit-build",
  [string]$Live = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [ValidateSet("Interactive", "S4U")][string]$OwnerLogon = "Interactive", # S4U only for a machine nobody signs in to (CI)
  [string]$PasswordFile = "" # CI only: two lines, the orbit-builder and orbit-build passwords. On the PC you're asked instead.
)
$ErrorActionPreference = "Stop"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Run this from an elevated PowerShell." }
$node = (Get-Command node -ErrorAction Stop).Source
$home_ = "C:\ProgramData\orbit-supervisor"; $app = Join-Path $home_ "app"
$stage = "C:\orbit-stage"; $cache = "C:\orbit-build-cache"; $bhome = "C:\orbit-builder"
$results = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "orbit-install"
foreach ($u in $Builder, $BuildUser) {
  if (-not (Get-LocalUser -Name $u -ErrorAction SilentlyContinue)) { throw "Create the account first: net user $u * /add" }
  if (Get-LocalGroupMember -Group Administrators -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "\\$u$" }) { throw "$u must not be an administrator" }
}

# Tasks that run without a signed-in session need "Log on as a batch job" for the two service accounts.
function Grant-BatchLogon([string[]]$users) {
  $sids = $users | ForEach-Object { "*" + (New-Object Security.Principal.NTAccount $_).Translate([Security.Principal.SecurityIdentifier]).Value }
  $tmp = Join-Path $env:TEMP "orbit-secpol"; New-Item -ItemType Directory -Force $tmp | Out-Null
  secedit /export /cfg "$tmp\cur.inf" /areas USER_RIGHTS | Out-Null
  $line = (Get-Content "$tmp\cur.inf") | Where-Object { $_ -match '^SeBatchLogonRight' }
  $have = if ($line) { ($line -split '=', 2)[1].Trim() -split ',' } else { @() }
  $all = @($have + $sids | Where-Object { $_ } | Select-Object -Unique) -join ','
  "[Unicode]`nUnicode=yes`n[Version]`nsignature=`"`$CHICAGO`$`"`nRevision=1`n[Privilege Rights]`nSeBatchLogonRight = $all" | Set-Content "$tmp\new.inf" -Encoding Unicode
  secedit /configure /db "$tmp\new.sdb" /cfg "$tmp\new.inf" /areas USER_RIGHTS | Out-Null
  Remove-Item $tmp -Recurse -Force
}
Grant-BatchLogon @($Builder, $BuildUser)

# 1. The supervisor's installed copy: changes to supervisor\ in the repo don't reach it until this script runs again.
New-Item -ItemType Directory -Force -Path $app, (Join-Path $app "windows"), "$home_\inbox", "$home_\public", "$home_\releases", "$home_\ctl", "$home_\mirror.git" | Out-Null
Copy-Item (Join-Path $Live "supervisor\*.ts"), (Join-Path $Live "supervisor\package.json") $app -Force
Copy-Item (Join-Path $Live "supervisor\windows\*.ps1") (Join-Path $app "windows") -Force

# 2. ACLs. /inheritance:r drops inherited rights, then each folder gets exactly what's listed.
icacls $home_ /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
# inbox: the owner (ORBIT's controls) and the builder (submissions) may add files, not list the folder or delete-child.
# Only a file's creator may write, rename or delete it (CREATOR OWNER), so nobody can touch another's submission or control file.
foreach ($u in $Owner, $Builder) { icacls "$home_\inbox" /grant "${u}:(WD,X)" | Out-Null }
icacls "$home_\inbox" /grant "*S-1-3-0:(OI)(IO)M" | Out-Null # CREATOR OWNER: modify (incl. rename) only what you created
foreach ($u in $Owner, $Builder, $BuildUser) {
  icacls "$home_\mirror.git" /grant "${u}:(OI)(CI)RX" | Out-Null # the supervisor clones into it on first run; files inherit this
  icacls "$home_\public" /grant "${u}:(OI)(CI)RX" | Out-Null
}
icacls "$home_\releases" /grant "${Owner}:(OI)(CI)RX" | Out-Null # the install task copies snapshots from here
foreach ($d in $stage, $cache) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  icacls $d /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "${BuildUser}:(OI)(CI)M" | Out-Null
}
New-Item -ItemType Directory -Force -Path $bhome, $results | Out-Null
icacls $bhome /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "${Builder}:(OI)(CI)M" "${Owner}:(OI)(CI)(RX,WD,AD)" | Out-Null

# 3. Config. Token: a fine-grained GitHub token for this repo only (Contents RW, Pull requests RW, Checks R) in token.txt.
$cfgFile = Join-Path $home_ "config.json"
if (-not (Test-Path $cfgFile)) {
  $ps = @("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File")
  @{
    repoUrl = "https://github.com/andreaskuus14/orbit.git"; mainBranch = "main"; liveDir = $Live; distDir = ".next"; stageDir = $stage
    healthUrl = "http://127.0.0.1:3000/api/health"; serverLog = (Join-Path $Live "orbit-server.log")
    commands = @{
      build = $ps + @((Join-Path $app "windows\trigger-build.ps1"), "{commit}", "{stage}", $Live, $BuildUser)
      install = $ps + @((Join-Path $app "windows\trigger-install.ps1"), "{commit}", "{dist}", $results)
      stop = @("cmd.exe", "/c", "exit 0"); start = @("cmd.exe", "/c", "exit 0") # unused while install is set
      stopBuilder = @("schtasks.exe", "/End", "/TN", "ORBIT Builder")
    }
    github = @{ repo = "andreaskuus14/orbit"; tokenFile = (Join-Path $home_ "token.txt"); checksTimeoutSec = 1800; requiredChecks = @("check") }
    enabled = $false
    stopAllFile = (Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "orbit\stop-all.json")
    workflowChecks = @(@{ name = "sign-in page"; url = "http://127.0.0.1:3000/login"; expect = 200 })
    monitor = @{ probes = 10; intervalSec = 60; maxErrors = 0; startupTimeoutSec = 300 }
    dataBackup = @{ paths = @((Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "orbit")); maxBytes = 2000000000 }
    keepReleases = 5; pollSec = 30
  } | ConvertTo-Json -Depth 5 | Set-Content $cfgFile -Encoding UTF8
}

# 4. Tasks. Each registration names its task if it fails. The two service accounts run "whether logged on or not" with a stored
#    password (Windows refuses S4U for another local account); Task Scheduler keeps it in LSA secrets, not on disk.
function Register-Task([string]$name, [hashtable]$a) {
  try { Register-ScheduledTask -TaskName $name -Force @a -ErrorAction Stop | Out-Null }
  catch { throw "registering task '$name' as $(if ($a.User) { $a.User } else { $a.Principal.UserId }): $($_.Exception.Message)" }
}
$pwLines = if ($PasswordFile) { @(Get-Content -LiteralPath $PasswordFile) } else { @() }
function Get-Pw([string]$u, [int]$i) {
  if ($pwLines.Count -gt $i) { return $pwLines[$i] }
  $sec = Read-Host "Password of $u (as set with net user)" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$keep = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File"
Register-Task "ORBIT Supervisor" @{ Settings = $keep; Trigger = (New-ScheduledTaskTrigger -AtStartup)
  Action = (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$node`" --no-warnings --experimental-strip-types `"$app\supervisor.ts`" watch >> `"$home_\supervisor.log`" 2>&1`"" -WorkingDirectory $app)
  Principal = (New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest) }
[Environment]::SetEnvironmentVariable("ORBIT_SUPERVISOR_HOME", $home_, "Machine")
[Environment]::SetEnvironmentVariable("ORBIT_SELFDEV_HOME", $bhome, "Machine") # read by ORBIT's DEV view and the builder

$ownerTask = New-ScheduledTaskPrincipal -UserId $Owner -LogonType $OwnerLogon -RunLevel Limited
Register-Task "ORBIT App" @{ Settings = $set; Principal = $ownerTask
  Action = (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "$psArgs `"$Live\scripts\launch.ps1`" -ServerOnly" -WorkingDirectory $Live) }
Register-Task "ORBIT Release Install" @{ Settings = $set; Principal = $ownerTask
  Action = (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "$psArgs `"$app\windows\release-install.ps1`" -Live `"$Live`" -Results `"$results`"" -WorkingDirectory $Live) }
Register-Task "ORBIT Release Build" @{ Settings = $set; User = $BuildUser; Password = (Get-Pw $BuildUser 1); RunLevel = "Limited"
  Action = (New-ScheduledTaskAction -Execute "powershell.exe" -Argument "$psArgs `"$app\windows\release-build.ps1`" -Stage `"$stage`" -Cache `"$cache`"" -WorkingDirectory $stage) }
Register-Task "ORBIT Builder" @{ Settings = $keep; Trigger = (New-ScheduledTaskTrigger -AtStartup); User = $Builder; Password = (Get-Pw $Builder 0); RunLevel = "Limited"
  Action = (New-ScheduledTaskAction -Execute $node -Argument "--no-warnings --experimental-strip-types `"$bhome\repo\selfdev\builder.ts`" run" -WorkingDirectory $bhome) }
Disable-ScheduledTask -TaskName "ORBIT Builder" | Out-Null

Write-Host "Installed (unattended releases OFF). Next: token.txt, review config.json, then (elevated) node --experimental-strip-types `"$app\supervisor.ts`" adopt"
Write-Host "Builder (as $Builder): clone $home_\mirror.git to $bhome\repo, npm ci, write $bhome\config.json. Then run the checks in supervisor\README.md 'Enabling'."
