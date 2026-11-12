# Trial 29 (Scrapling). One command:  .\scrape-trial.ps1
# Installs Scrapling into tools\trials\.venv only (not ORBIT, not package.json), then compares fetchers on pages.txt.
$ErrorActionPreference = "Stop"; Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -c "import scrapling.fetchers" 2>$null
if ($LASTEXITCODE -ne 0) { & $py -m pip install --quiet "scrapling[fetchers]"; & $py -m scrapling install }
node --experimental-strip-types --import ./lib/load.mjs scrape-trial.mjs @args
