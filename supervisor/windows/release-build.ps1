# Build side ("ORBIT Release Build" task, the orbit-build account): fresh clone of the supervisor's mirror at the requested
# commit, fresh `npm ci` (dependency install scripts run here, as this account), `next build`. Always writes BUILD_RESULT.txt.
# This account can write only its stage and npm cache; it can't read the owner's files or the supervisor's secrets.
param([Parameter(Mandatory)][string]$Stage, [string]$Cache = "C:\orbit-build-cache")
$ErrorActionPreference = "Continue" # native tools write progress to stderr; failures are judged by exit codes
$sup = "C:\ProgramData\orbit-supervisor"
$log = Join-Path $Cache "release-build.log"
$commit = "0000000000000000000000000000000000000000"; $code = 1
function Native([string]$line) { cmd /c "$line >> `"$log`" 2>&1"; if ($LASTEXITCODE) { throw "failed ($LASTEXITCODE): $line" } }
try {
  Set-Content -LiteralPath $log -Value "$(Get-Date -Format o) release build as $env:USERNAME"
  $req = Get-Content -LiteralPath "$sup\public\build-request.json" -Raw | ConvertFrom-Json
  $commit = [string]$req.commit
  if ($commit -notmatch '^[0-9a-f]{40}$') { throw "bad commit" }
  Get-ChildItem -LiteralPath $Stage -Force | Remove-Item -Recurse -Force -ErrorAction Stop # fresh every time
  # The mirror belongs to SYSTEM; git trusts another owner's repo only through global config.
  $gc = Join-Path $Cache "gitconfig"; Set-Content -LiteralPath $gc -Value "[safe]`n`tdirectory = $($sup -replace '\\','/')/mirror.git"
  $env:GIT_CONFIG_GLOBAL = $gc
  Native "git clone --quiet --no-checkout `"$sup\mirror.git`" `"$Stage`""
  Native "git -C `"$Stage`" checkout --quiet --detach $commit"
  foreach ($p in $req.env.PSObject.Properties) { Set-Item -Path "Env:$($p.Name)" -Value ([string]$p.Value) }
  $env:npm_config_cache = Join-Path $Cache "npm"; $env:NEXT_TELEMETRY_DISABLED = "1"
  Push-Location $Stage
  try { Native "npm.cmd ci --no-audit --no-fund"; Native "npm.cmd run build"; $code = 0 } finally { Pop-Location }
} catch { Add-Content $log $_.Exception.Message; $code = 1 }
Set-Content -LiteralPath (Join-Path $Stage "BUILD_RESULT.txt") -Value "$commit $code"
