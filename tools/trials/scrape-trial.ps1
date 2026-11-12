# Trial 29 (Scrapling). One command:  .\scrape-trial.ps1
# Installs Scrapling into tools\trials\.venv only (after you type yes; not ORBIT, not package.json), then compares fetchers on pages.txt.
$ErrorActionPreference = "Stop"; Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -c "import scrapling.fetchers" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Install commands:`n  $py -m pip install `"scrapling[fetchers]`"`n  $py -m scrapling install   (downloads browsers)"
  if ((Read-Host 'Type yes to run them') -ne "yes") { Write-Host "Not installed; stopping."; exit 1 }
  & $py -m pip install --quiet "scrapling[fetchers]"; & $py -m scrapling install
}
node --experimental-strip-types --import ./lib/load.mjs scrape-trial.mjs @args
