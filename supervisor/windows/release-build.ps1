# Owner side ("ORBIT Release Build" task): build the commit the supervisor asked for in a separate stage checkout.
# Writes BUILD_RESULT.txt = "<commit> <exit code>". The live folder isn't touched; the supervisor installs the result.
param([Parameter(Mandatory)][string]$Stage, [Parameter(Mandatory)][string]$Live)
$ErrorActionPreference = "Stop"
$commit = (Get-Content -LiteralPath "C:\ProgramData\orbit-supervisor\public\build-request.txt" -Raw).Trim()
if ($commit -notmatch '^[0-9a-f]{40}$') { exit 1 }
$result = Join-Path $Stage "BUILD_RESULT.txt"
$code = 1
try {
  if (-not (Test-Path (Join-Path $Stage ".git"))) { git clone --quiet $Live $Stage }
  git -C $Stage fetch --quiet origin
  git -C $Stage fetch --quiet https://github.com/andreaskuus14/orbit.git $commit 2>$null
  git -C $Stage checkout --quiet --detach $commit
  if ((git -C $Stage rev-parse HEAD) -ne $commit) { throw "checkout failed" }
  # Same dependencies as live (the release policy refuses package.json / lockfile changes); a junction avoids a second install.
  if (-not (Test-Path (Join-Path $Stage "node_modules"))) { cmd /c mklink /J (Join-Path $Stage "node_modules") (Join-Path $Live "node_modules") | Out-Null }
  # NEXT_PUBLIC_* values are baked into the build, so the stage uses live's .env.local.
  Copy-Item (Join-Path $Live ".env.local") (Join-Path $Stage ".env.local") -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $Stage ".next") -ErrorAction SilentlyContinue
  Push-Location $Stage
  try { cmd /c "npm.cmd run build > `"$Stage\release-build.log`" 2>&1"; $code = $LASTEXITCODE } finally { Pop-Location }
} catch { Add-Content (Join-Path $Stage "release-build.log") $_.Exception.Message; $code = 1 }
Set-Content -LiteralPath $result -Value "$commit $code"
