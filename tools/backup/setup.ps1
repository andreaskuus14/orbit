# ORBIT one-time privacy setup: the journal key (encryption at rest) + nightly encrypted backups (restic).
# Run from the ORBIT folder:  powershell -ExecutionPolicy Bypass -File tools\backup\setup.ps1
#   -Repo D:\orbit-restic     where backups go (default: %USERPROFILE%\orbit-restic; an external/other drive is better)
#   -Keep 14                  daily snapshots kept (plus 8 weekly and 12 monthly)
#   -Cloud "remote:orbit"     OPTIONAL extra copy through rclone to a remote YOU made with `rclone config`. Without it nothing leaves this PC.
#   -At 03:20                 nightly time
#   -SkipJournal              don't encrypt the journal now (you can later: npm run journal:encrypt)
# What it does: 1) makes the journal key and shows your RECOVERY KEY  2) installs restic (winget)  3) makes the backup password
# 4) creates the repo, the nightly task, runs a first backup and a test restore  5) encrypts the journal (backup first).
# Safe to run again: existing keys, passwords and repos are kept.
param([string]$Repo = (Join-Path $env:USERPROFILE "orbit-restic"), [int]$Keep = 14, [string]$Cloud = "", [string]$At = "03:20", [switch]$SkipJournal)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "Node.js isn't on PATH. Install it (or open the ORBIT terminal) and run this again." -ForegroundColor Red; exit 1 }
function Ts([string[]]$a) { & $node --no-warnings --experimental-strip-types @a; if ($LASTEXITCODE -ne 0) { throw "failed: $($a -join ' ')" } }
$paths = (& $node --no-warnings --experimental-strip-types scripts/backup-run.ts paths) | ConvertFrom-Json

function Lock-Folder([string]$dir) {
  # Only you (and SYSTEM, which Windows needs) can read the keys folder; inherited rights are removed.
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  & icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" | Out-Null
}

# ---- 1. Journal key ----
Write-Host "`n== 1/5 Journal key ==" -ForegroundColor Cyan
Lock-Folder $paths.keys
& $node --no-warnings --experimental-strip-types scripts/journal-key.ts init
if ($LASTEXITCODE -ne 0) { Write-Host "No journal key was saved. Nothing else was changed. Run this again when you can write the recovery key down." -ForegroundColor Red; exit 1 }
Lock-Folder $paths.keys
Write-Host "Losing BOTH the key file and the recovery key means losing the journal. Keep the recovery key somewhere safe, off this PC." -ForegroundColor Yellow

# ---- 2. restic ----
Write-Host "`n== 2/5 restic ==" -ForegroundColor Cyan
function Find-Restic {
  $c = Get-Command restic -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $w = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Recurse -Filter "restic*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($w) { return $w.FullName }
  return $null
}
$restic = Find-Restic
if (-not $restic) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Host "winget isn't available: get restic from https://restic.net (Windows zip), put restic.exe on PATH, run this again." -ForegroundColor Red; exit 1 }
  winget install --id restic.restic -e --accept-source-agreements --accept-package-agreements
  $restic = Find-Restic
  if (-not $restic) { Write-Host "restic didn't install. Get it from https://restic.net and run this again." -ForegroundColor Red; exit 1 }
}
Write-Host "restic: $restic"
if ($Cloud) {
  if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { winget install --id Rclone.Rclone -e --accept-source-agreements --accept-package-agreements }
  if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) { Write-Host "rclone isn't on PATH yet: open a new window and run this again (or drop -Cloud)." -ForegroundColor Red; exit 1 }
  $remote = $Cloud.Split(":")[0]
  if (-not ((& rclone listremotes) -contains "${remote}:")) { Write-Host "rclone has no remote called '$remote'. Make it first with: rclone config" -ForegroundColor Red; exit 1 }
}

# ---- 3. Config + backup password ----
Write-Host "`n== 3/5 Backup password and settings ==" -ForegroundColor Cyan
$a = @("scripts/backup-run.ts", "setup", "--repo", $Repo, "--keep", "$Keep", "--bin", $restic)
if ($Cloud) { $a += @("--cloud", $Cloud) }
$s = (& $node --no-warnings --experimental-strip-types @a) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { exit 1 }
Lock-Folder $paths.keys
if ($s.newPassword) {
  Write-Host "`n BACKUP PASSWORD (restic repo):  $($s.newPassword)" -ForegroundColor Yellow
  Write-Host " Save it in your password manager. Without it the backups can't be opened. It is in $($s.passFile) on this PC only.`n" -ForegroundColor Yellow
  $last = $s.newPassword.Substring($s.newPassword.Length - 6)
  if ((Read-Host "Type the last 6 characters to confirm you saved it") -ne $last) { Write-Host "Doesn't match. Run this script again after saving it (the password stays the same)." -ForegroundColor Red; exit 1 }
}
$env:RESTIC_PASSWORD_FILE = $s.passFile
& $restic -r $Repo cat config *> $null
if ($LASTEXITCODE -ne 0) { & $restic -r $Repo init; if ($LASTEXITCODE -ne 0) { throw "restic init failed" } }
if ($Cloud) {
  & $restic -r "rclone:$Cloud" cat config *> $null
  if ($LASTEXITCODE -ne 0) { & $restic -r "rclone:$Cloud" init --from-repo $Repo --from-password-file $s.passFile --copy-chunker-params; if ($LASTEXITCODE -ne 0) { throw "cloud repo init failed" } }
}

# ---- 4. Nightly task, first backup, test restore ----
Write-Host "`n== 4/5 Nightly backup ==" -ForegroundColor Cyan
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\tools\backup\backup.ps1`""
$trg = New-ScheduledTaskTrigger -Daily -At $At
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "ORBIT nightly backup" -Action $act -Trigger $trg -Settings $set -Description "ORBIT encrypted backup (restic). tools\backup\README.md" -Force | Out-Null
Write-Host "Task Scheduler: 'ORBIT nightly backup' every day at $At (runs later if the PC was off)."
Ts @("scripts/backup-run.ts", "run")
$test = Join-Path $env:TEMP ("orbit-restore-test-" + (Get-Date -Format "yyyyMMddHHmmss"))
Ts @("scripts/backup-run.ts", "restore", "--snapshot", "latest", "--target", $test)
$found = Get-ChildItem $test -Recurse -File -ErrorAction SilentlyContinue | Measure-Object
if ($found.Count -lt 1) { Write-Host "The test restore found no files: check tools\backup\README.md before trusting the backups." -ForegroundColor Red; exit 1 }
Write-Host "Test restore OK: $($found.Count) file(s) in $test (delete that folder when you've looked)."

# ---- 5. Encrypt the journal ----
Write-Host "`n== 5/5 Journal encryption ==" -ForegroundColor Cyan
if ($SkipJournal) { Write-Host "Skipped. Later: npm run app:stop, then npm run journal:encrypt"; exit 0 }
Write-Host "ORBIT will be stopped for a moment. The journal is backed up (encrypted) first and every entry is checked before plain text is replaced."
if ((Read-Host "Encrypt the journal now? [y/N]") -notmatch '^[yYjJ]') { Write-Host "Later: npm run app:stop, then npm run journal:encrypt"; exit 0 }
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\stop.ps1" | Out-Null
Ts @("scripts/journal-encrypt.ts")
Ts @("scripts/journal-encrypt.ts", "--check")
Write-Host "`nDone. Start ORBIT again (npm run app:start). LIFE -> Journal looks the same; the doctor shows key and backup age." -ForegroundColor Green
