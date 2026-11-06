# Supervisor side (SYSTEM): have the "ORBIT Release Build" task (the orbit-build account) build exactly <commit>, then end every
# process of that account before the supervisor snapshots the result. Repo code never runs as SYSTEM or as the owner here.
# The build gets only NEXT_PUBLIC_* values (public by design: they ship to the browser), never .env.local's secrets.
param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$Stage, [Parameter(Mandatory)][string]$Live, [string]$BuildUser = "orbit-build")
$ErrorActionPreference = "Stop"
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "bad commit" }
$envs = @{}
$dotenv = Join-Path $Live ".env.local"
if (Test-Path -LiteralPath $dotenv -PathType Leaf) {
  foreach ($l in Get-Content -LiteralPath $dotenv) { if ($l -match '^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)$') { $envs[$Matches[1]] = $Matches[2].Trim().Trim('"') } }
}
@{ commit = $Commit; env = $envs } | ConvertTo-Json | Set-Content -LiteralPath "C:\ProgramData\orbit-supervisor\public\build-request.json" -Encoding UTF8
$result = Join-Path $Stage "BUILD_RESULT.txt"
Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
$started = (Get-Date).AddSeconds(-2)
schtasks.exe /Run /TN "ORBIT Release Build" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "couldn't start the ORBIT Release Build task" }
try {
  $deadline = (Get-Date).AddMinutes(40)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $ti = Get-ScheduledTaskInfo -TaskName "ORBIT Release Build" -ErrorAction SilentlyContinue
    if (-not (Test-Path $result) -and $ti -and (Get-ScheduledTask -TaskName "ORBIT Release Build").State -eq "Ready" -and $ti.LastRunTime -gt $started) { Start-Sleep -Seconds 3; if (-not (Test-Path $result)) { throw "the ORBIT Release Build task ended without a result (task result $($ti.LastTaskResult))" } }
    if (Test-Path $result) {
      $r = (Get-Content -LiteralPath $result -Raw).Trim() -split "\s+"
      if ($r[0] -ne $Commit) { throw "stage built $($r[0]), not $Commit" }
      if ($r[1] -ne "0") { throw "build failed (exit $($r[1])); see $Stage\release-build.log" }
      return
    }
  }
  throw "build didn't finish in 40 minutes"
} finally {
  # Nothing the build started may keep running (or keep editing the stage) while the supervisor copies it.
  schtasks.exe /End /TN "ORBIT Release Build" 2>$null | Out-Null
  Get-CimInstance Win32_Process | Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue).User -eq $BuildUser } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
