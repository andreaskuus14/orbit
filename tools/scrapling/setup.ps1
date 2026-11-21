# One-time setup for ORBIT's web reading ladder (src/lib/web-ladder.ts): fetch -> Scrapling -> headless browser.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\scrapling\setup.ps1
# 1) Scrapling (the scraper rung) into tools\scrapling\.venv only (ORBIT finds it there; nothing global, not package.json).
# 2) The browser rung uses the Chrome or Edge already on this PC. Only when neither is found does it download
#    Playwright's own Chromium (npx playwright-core install chromium, about 150 MB).
# Safe to run again: it skips what is already there. Restart ORBIT afterwards (or wait 10 minutes: the ladder re-checks).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { Write-Host "Python 3.10+ is needed for the scraper rung: install it from python.org (tick 'Add to PATH'), then run this again."; exit 1 }
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
# Windows PowerShell 5.1 turns a native command's stderr into an error under "Stop", so probe with cmd and plain exit codes.
function Test-Py([string]$code) { cmd /c "`"$py`" -c `"$code`" >nul 2>nul"; return ($LASTEXITCODE -eq 0) }
if (-not (Test-Py "import scrapling.fetchers")) {
  & $py -m pip install --quiet --upgrade pip
  & $py -m pip install --quiet "scrapling[fetchers]"
  & $py -m scrapling install   # browser fetchers for scrape_page's "browser"/"stealth" modes
}
if (Test-Py "import scrapling.fetchers") { Write-Host "Scrapling ready." } else { Write-Host "Scrapling didn't install: the scraper rung is skipped (fetch and browser still work). Run this again later." -ForegroundColor Yellow }

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($chrome) { Write-Host "Browser rung: using $chrome" }
else {
  Write-Host "No Chrome or Edge found: downloading Playwright's Chromium for the browser rung."
  Push-Location (Resolve-Path "$PSScriptRoot\..\..")
  npx playwright-core install chromium
  Pop-Location
}
Write-Host "Web ladder ready: fetch -> Scrapling -> browser."
