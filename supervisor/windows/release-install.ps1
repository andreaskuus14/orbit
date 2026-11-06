# Owner side ("ORBIT Release Install" task): stop ORBIT, swap in the supervisor's snapshot (read-only to this account), check out
# the released commit, mark the build current for the launcher, start ORBIT. Writes <Results>\INSTALL_RESULT.txt = "<commit> <0|1> <why>".
# The swap is by rename: if any file in the live build is locked (antivirus, an editor), nothing is half-deleted; the old build and
# checkout are put back and ORBIT is started on them, and the supervisor sees the failure.
param([Parameter(Mandatory)][string]$Live, [Parameter(Mandatory)][string]$Results)
$ErrorActionPreference = "Stop"
$home_ = "C:\ProgramData\orbit-supervisor"
$req = (Get-Content -LiteralPath "$home_\public\install-request.txt" -Raw) -split "`n"
$commit = $req[0].Trim(); $dist = $req[1].Trim()
New-Item -ItemType Directory -Force -Path $Results | Out-Null
$result = Join-Path $Results "INSTALL_RESULT.txt"
$nextDir = Join-Path $Live ".next"; $oldDir = Join-Path $Live ".next-supervisor-old"
$start = { Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Live\scripts\launch.ps1`" -ServerOnly" -WorkingDirectory $Live -WindowStyle Hidden }
$prevHead = $null; $swapped = $false
try {
  if ($commit -notmatch '^[0-9a-f]{40}$' -or -not ([IO.Path]::GetFullPath($dist)).StartsWith("$home_\releases\", [StringComparison]::OrdinalIgnoreCase)) { throw "bad request" }
  if (git -C $Live status --porcelain --untracked-files=no) { throw "the live folder has local changes; not touching it" }
  $prevHead = (git -C $Live rev-parse HEAD).Trim()
  & (Join-Path $Live "scripts\stop.ps1")
  # The mirror belongs to SYSTEM; git trusts another owner's repo only via global config, so this fetch uses its own.
  $gc = Join-Path $Results "install-gitconfig"; Set-Content -LiteralPath $gc -Value "[safe]`n`tdirectory = $($home_ -replace '\\','/')/mirror.git"
  $env:GIT_CONFIG_GLOBAL = $gc
  try { git -C $Live fetch --quiet "$home_\mirror.git" $commit; if ($LASTEXITCODE) { throw "fetch failed" } } finally { Remove-Item Env:GIT_CONFIG_GLOBAL }
  if (Test-Path $oldDir) { Remove-Item -LiteralPath $oldDir -Recurse -Force }
  if (Test-Path $nextDir) { Rename-Item -LiteralPath $nextDir -NewName ".next-supervisor-old" } # fails as a whole if anything inside is locked
  $swapped = $true
  Copy-Item -LiteralPath $dist -Destination $nextDir -Recurse
  git -C $Live checkout --quiet -B main $commit; if ($LASTEXITCODE) { throw "checkout failed" }
  (Get-Item (Join-Path $nextDir "BUILD_ID")).LastWriteTime = Get-Date # the checkout touched src\; this build is current
  & $start
  Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue
  Set-Content -LiteralPath $result -Value "$commit 0 ok"
} catch {
  $why = $_.Exception.Message
  try {
    if ($swapped) {
      if (Test-Path $nextDir) { Remove-Item -LiteralPath $nextDir -Recurse -Force -ErrorAction SilentlyContinue }
      if (Test-Path $oldDir) { Rename-Item -LiteralPath $oldDir -NewName ".next" }
    }
    if ($prevHead) { git -C $Live checkout --quiet -B main $prevHead }
    if ($prevHead -and (Test-Path (Join-Path $nextDir "BUILD_ID"))) { (Get-Item (Join-Path $nextDir "BUILD_ID")).LastWriteTime = Get-Date }
    & $start # back on the previous build
  } catch { $why += "; restoring the previous build also failed: $($_.Exception.Message)" }
  Set-Content -LiteralPath $result -Value "$commit 1 $why"
}
