# One-click scripted perf run (roadmap 1.2): npm run perf:run
# Makes sure the ORBIT server runs, then for each window size opens ORBIT in a Chrome --app window with ?perfrun=1
# (your normal profile, so you stay signed in), waits for the run's report (about 90 s each: boot, galaxy idle,
# STUDIO, INTELLIGENCE, MEMORY, ARCH, AGENTS, dive, idle) and prints it compared with the previous run at that size.
# Reports: <ORBIT data dir>\perf-runs\<ms>.json. Hands off the PC while it runs; another window on top skews nothing,
# but minimising ORBIT's window marks the run invalid. Exit code 2 = a p95 regression over 15%.
#   -Sizes "1536x864","1920x1080"   window sizes to run (outer size, like --window-size)
param([string[]]$Sizes = @("1536x864", "1920x1080"))
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000"
Set-Location $root

try { Invoke-RestMethod "http://127.0.0.1:3000/api/health" -TimeoutSec 3 | Out-Null }
catch {
  Write-Host "ORBIT server is not running: starting it..."
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "launch.ps1") -ServerOnly
}

$browsers = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { Write-Host "Chrome not found." -ForegroundColor Red; exit 1 }

$worst = 0
foreach ($size in $Sizes) {
  if ($size -notmatch '^(\d+)x(\d+)$') { Write-Host "Skipping bad size $size" -ForegroundColor Yellow; continue }
  $w = $Matches[1]; $h = $Matches[2]
  $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Write-Host "`n== Perf run at $size (hands off) ==" -ForegroundColor Cyan
  Start-Process $chrome "--app=$url/?perfrun=1&label=$size&w=$w&h=$h --window-size=$w,$h --window-position=0,0"
  & node --no-warnings --experimental-strip-types scripts/perf-run.ts --wait $size --since $since --timeout 240
  if ($LASTEXITCODE -gt $worst) { $worst = $LASTEXITCODE }
  Start-Sleep -Seconds 3 # the window closes itself after saving
}
if ($worst -eq 2) { Write-Host "p95 regression flagged (over 15% slower than the previous run)." -ForegroundColor Red }
elseif ($worst -eq 3) { Write-Host "A run did not report. Open $url/?perfrun=1 in Chrome to see what happens." -ForegroundColor Yellow }
else { Write-Host "Done: no regressions." -ForegroundColor Green }
exit $worst
