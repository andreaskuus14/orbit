# Owner side ("ORBIT Release Install" task): stop ORBIT, check out the released commit in the live folder, swap in the
# supervisor's snapshot of its build (read-only to this account), mark it current for the launcher, start ORBIT.
# Writes INSTALL_RESULT.txt = "<commit> <0|1> <message>". The supervisor then health-checks the result itself.
param([Parameter(Mandatory)][string]$Live, [Parameter(Mandatory)][string]$Stage)
$ErrorActionPreference = "Stop"
$home_ = "C:\ProgramData\orbit-supervisor"
$req = (Get-Content -LiteralPath "$home_\public\install-request.txt" -Raw) -split "`n"
$commit = $req[0].Trim(); $dist = $req[1].Trim()
$result = Join-Path $Stage "INSTALL_RESULT.txt"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
try {
  if ($commit -notmatch '^[0-9a-f]{40}$' -or -not ([IO.Path]::GetFullPath($dist)).StartsWith("$home_\releases\", [StringComparison]::OrdinalIgnoreCase)) { throw "bad request" }
  if (git -C $Live status --porcelain --untracked-files=no) { throw "the live folder has local changes; not touching it" }
  & (Join-Path $Live "scripts\stop.ps1")
  git -C $Live -c "safe.directory=$($home_ -replace '\\','/')/mirror.git" fetch --quiet "$home_\mirror.git" $commit
  if ($LASTEXITCODE) { throw "fetch failed" }
  git -C $Live checkout --quiet -B main $commit
  if ($LASTEXITCODE) { throw "checkout failed" }
  $live = Join-Path $Live ".next"
  if (Test-Path $live) { Remove-Item -LiteralPath $live -Recurse -Force }
  Copy-Item -LiteralPath $dist -Destination $live -Recurse
  (Get-Item (Join-Path $live "BUILD_ID")).LastWriteTime = Get-Date # the checkout touched src\; this build is current
  Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Live\scripts\launch.ps1`" -ServerOnly" -WorkingDirectory $Live -WindowStyle Hidden
  Set-Content -LiteralPath $result -Value "$commit 0 ok"
} catch { Set-Content -LiteralPath $result -Value "$commit 1 $($_.Exception.Message)" }
