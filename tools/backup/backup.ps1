# Nightly ORBIT backup (run by Task Scheduler "ORBIT nightly backup"; set up by tools\backup\setup.ps1). Log: %LOCALAPPDATA%\orbit\backup.log
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$log = Join-Path $env:LOCALAPPDATA "orbit\backup.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
& node --no-warnings --experimental-strip-types scripts/backup-run.ts run *>> $log
exit $LASTEXITCODE
