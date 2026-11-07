# Installs the ORBIT test runner (run elevated, after install.ps1): the orbit-test account's folders and rights, the "ORBIT Test
# Runner" task, its outbound firewall rule, and the supervisor config that routes the builder's tests to it.
# orbit-test runs every test, gate and build the builder asks for, instead of the builder's own account, so model-written code
# never runs where the model credential or the spending settings are. The account must exist first (created by the owner:
# `net user orbit-test * /add`, a standard user, never signed in). CI creates a throwaway one; nothing here runs on the PC
# until the owner decides to.
param(
  [string]$TestUser = "orbit-test", [string]$Builder = "orbit-builder",
  [string]$Modules = "C:\orbit-builder\repo\node_modules", # the builder's installed dependencies, read-only to orbit-test
  [string]$PasswordFile = "" # CI only: one line, the orbit-test password. On the PC you're asked instead.
)
$ErrorActionPreference = "Stop"
$home_ = "C:\ProgramData\orbit-supervisor"; $app = "$home_\app"; $T = "C:\orbit-test"
if (-not (Test-Path "$app\test-run.ts")) { throw "run install.ps1 first (it copies supervisor\*.ts, test-run.ts included, to $app)" }
if (-not (Get-LocalUser $TestUser -ErrorAction SilentlyContinue)) { throw "create $TestUser first: net user $TestUser * /add (a standard account)" }
if (Get-LocalGroupMember -Group Administrators -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "\\$TestUser$" }) { throw "$TestUser must not be an administrator" }
$sid = (New-Object Security.Principal.NTAccount $TestUser).Translate([Security.Principal.SecurityIdentifier]).Value

# Logon rights: batch only (the task); no interactive or remote desktop logon.
function Add-Right([string]$right, [string]$sidValue) {
  $tmp = Join-Path $env:TEMP "orbit-secpol-$right"; New-Item -ItemType Directory -Force $tmp | Out-Null
  secedit /export /cfg "$tmp\cur.inf" /areas USER_RIGHTS | Out-Null
  $line = (Get-Content "$tmp\cur.inf") | Where-Object { $_ -match "^$right\s*=" }
  $have = if ($line) { ($line -split '=', 2)[1].Trim() -split ',' } else { @() }
  $all = @($have + "*$sidValue" | Where-Object { $_ } | Select-Object -Unique) -join ','
  "[Unicode]`nUnicode=yes`n[Version]`nsignature=`"`$CHICAGO`$`"`nRevision=1`n[Privilege Rights]`n$right = $all" | Set-Content "$tmp\new.inf" -Encoding Unicode
  secedit /configure /db "$tmp\new.sdb" /cfg "$tmp\new.inf" /areas USER_RIGHTS | Out-Null
  Remove-Item $tmp -Recurse -Force
}
foreach ($r in "SeBatchLogonRight", "SeDenyInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight") { Add-Right $r $sid }

# Folders. C:\orbit-test: SYSTEM and Administrators only, then per folder:
#   req\     the builder creates requests (one write each, CREATOR OWNER keeps them its own); the runner reads them
#   run\     the supervisor writes which request runs now; the runner reads it
#   results\ the runner writes results; the builder reads them
#   work\    the runner's disposable checkouts and per-run home
foreach ($d in "", "\req", "\run", "\results", "\work") { New-Item -ItemType Directory -Force "$T$d" | Out-Null }
icacls $T /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
icacls "$T\req" /grant "${Builder}:(WD,X)" "*S-1-3-0:(OI)(IO)M" "${TestUser}:(OI)(CI)RX" | Out-Null
icacls "$T\run" /grant "${TestUser}:(OI)(CI)RX" | Out-Null
icacls "$T\results" /grant "${TestUser}:(OI)(CI)M" "${Builder}:(OI)(CI)RX" | Out-Null
icacls "$T\work" /grant "${TestUser}:(OI)(CI)M" | Out-Null
# What the runner reads: its code (no secrets in app\: token, config and state sit in the supervisor home itself), the mirror, the
# builder's dependencies. Nothing else of the supervisor's, the builder's (config, state, worktrees, model login) or the owner's.
icacls $app /grant "${TestUser}:(OI)(CI)RX" | Out-Null
icacls "$home_\mirror.git" /grant "${TestUser}:(OI)(CI)RX" | Out-Null
if (Test-Path $Modules) { icacls $Modules /grant "${TestUser}:(OI)(CI)RX" | Out-Null } else { Write-Warning "$Modules not found: run npm ci in the builder's repo, then this script again" }

# The sandbox every test command runs in: an AppContainer with no capabilities (no network, no loopback to the host's services,
# no name resolution; files only where granted). Compiled here with the compiler that ships with Windows.
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
Copy-Item (Join-Path $PSScriptRoot "orbit-sandbox.cs") "$app\windows\orbit-sandbox.cs" -Force # install.ps1 copies only *.ps1
& $csc /nologo /optimize /target:exe "/out:$app\windows\orbit-sandbox.exe" "$app\windows\orbit-sandbox.cs" | Out-Host
if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$app\windows\orbit-sandbox.exe")) { throw "compiling orbit-sandbox.exe failed" }
$acSid = (& "$app\windows\orbit-sandbox.exe" --sid).Trim()
if ($acSid -notmatch '^S-1-15-2-') { throw "orbit-sandbox.exe --sid returned '$acSid'" }
# What sandboxed tests may open: their checkouts and per-run homes (work\), the builder's node_modules (read), node itself (read).
# Windows and Program Files already grant ALL APPLICATION PACKAGES read; nothing of the builder's, supervisor's or owner's does.
icacls "$T\work" /grant "*${acSid}:(OI)(CI)M" | Out-Null
if (Test-Path $Modules) { icacls $Modules /grant "*${acSid}:(OI)(CI)RX" | Out-Null }
$nodeDir = Split-Path (Get-Command node.exe -ErrorAction Stop).Source
icacls $nodeDir /grant "*${acSid}:(OI)(CI)RX" | Out-Null
# Node resolves real paths by reading the attributes of every parent folder (lstat C:\, C:\orbit-test, ...). Grant exactly that on
# the parents: read and list this folder only (not inherited: nothing below it opens).
foreach ($leaf in "$T\work", $Modules, $nodeDir) {
  $d = Split-Path $leaf -Parent
  while ($d) { icacls $d /grant "*${acSid}:(RX)" | Out-Null; $d = Split-Path $d -Parent } # this folder only: names, not contents below
}

# Network: nothing off the machine for this account, its child processes included (the rule matches the account, not a program).
# Windows Firewall doesn't filter loopback and names are resolved by the DNS Client service; the AppContainer above covers both.
$rule = "ORBIT test runner: no network"
Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $rule -Direction Outbound -Action Block -Profile Any -LocalUser "D:(A;;CC;;;$sid)" `
  -RemoteAddress @("0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255", "::", "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff") | Out-Null
$off = @(Get-NetFirewallProfile | Where-Object { -not $_.Enabled } | ForEach-Object Name)
if ($off.Count) { Write-Warning "Windows Firewall is off for: $($off -join ', '). The rule has no effect there." }

# The task. Stored password: Windows refuses S4U for another local account (as for the build account).
$pw = if ($PasswordFile) { @(Get-Content -LiteralPath $PasswordFile)[0] } else { # @(): one line would otherwise index into the string
  $sec = Read-Host "Password of $TestUser (as set with net user)" -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)) }
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$app\windows\test-run-task.ps1`"" -WorkingDirectory "$T\work"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 70) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
try { Register-ScheduledTask -TaskName "ORBIT Test Runner" -Force -Action $action -Settings $settings -User $TestUser -Password $pw -RunLevel Limited -ErrorAction Stop | Out-Null }
catch { throw "registering task 'ORBIT Test Runner' as ${TestUser}: $($_.Exception.Message)" }

# Route the builder's tests through it.
$c = Get-Content "$home_\config.json" -Raw | ConvertFrom-Json
$c | Add-Member -Force testRunner @{ reqDir = "$T\req"; outDir = "$T\results"
  command = @("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$app\windows\trigger-test.ps1", "-Req", "{req}", "-Bundle", "{bundle}", "-Out", "{out}", "-Modules", $Modules, "-TestUser", $TestUser) }
$c | ConvertTo-Json -Depth 6 | Set-Content "$home_\config.json" -Encoding UTF8
Write-Host "Test runner installed for $TestUser. The builder's config needs: `"testRunner`": { `"reqDir`": `"$T\\req`", `"outDir`": `"$T\\results`" }"
