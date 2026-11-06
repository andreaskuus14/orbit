# Build side ("ORBIT Release Build" task, the orbit-build account): fresh clone of the supervisor's mirror at the requested
# commit, fresh `npm ci` (dependency install scripts run here, as this account), `next build`. Writes BUILD_RESULT.txt.
# This account can write only its stage and npm cache; it can't read the owner's files or the supervisor's secrets.
param([Parameter(Mandatory)][string]$Stage, [string]$Cache = "C:\orbit-build-cache")
$ErrorActionPreference = "Stop"
$sup = "C:\ProgramData\orbit-supervisor"
$req = Get-Content -LiteralPath "$sup\public\build-request.json" -Raw | ConvertFrom-Json
$commit = [string]$req.commit
$log = Join-Path $Cache "release-build.log"
$code = 1
try {
  if ($commit -notmatch '^[0-9a-f]{40}$') { throw "bad commit" }
  Get-ChildItem -LiteralPath $Stage -Force | Remove-Item -Recurse -Force   # fresh every time: nothing from a previous build survives
  # The mirror belongs to SYSTEM; git trusts another owner's repo only through global config.
  $gc = Join-Path $Cache "gitconfig"; Set-Content -LiteralPath $gc -Value "[safe]`n`tdirectory = $($sup -replace '\\','/')/mirror.git"
  $env:GIT_CONFIG_GLOBAL = $gc
  git clone --quiet --no-checkout "$sup\mirror.git" $Stage 2>&1 | Out-File $log
  git -C $Stage checkout --quiet --detach $commit 2>&1 | Out-File $log -Append
  if ((git -C $Stage rev-parse HEAD) -ne $commit) { throw "checkout failed" }
  foreach ($p in $req.env.PSObject.Properties) { Set-Item -Path "Env:$($p.Name)" -Value ([string]$p.Value) }
  $env:npm_config_cache = Join-Path $Cache "npm"; $env:NEXT_TELEMETRY_DISABLED = "1"
  Push-Location $Stage
  try {
    cmd /c "npm.cmd ci --no-audit --no-fund >> `"$log`" 2>&1"; if ($LASTEXITCODE) { throw "npm ci failed" }
    cmd /c "npm.cmd run build >> `"$log`" 2>&1"; $code = $LASTEXITCODE
  } finally { Pop-Location }
} catch { Add-Content $log $_.Exception.Message; $code = 1 }
Set-Content -LiteralPath (Join-Path $Stage "BUILD_RESULT.txt") -Value "$commit $code"
