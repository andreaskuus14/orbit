# Supervisor side (SYSTEM): run one builder test request with the "ORBIT Test Runner" task (the orbit-test account), then end
# every process of that account. Model-written code never runs as SYSTEM, the owner or the builder.
param([Parameter(Mandatory)][string]$Req, [Parameter(Mandatory)][string]$Bundle, [Parameter(Mandatory)][string]$Out,
  [string]$Modules = "C:\orbit-builder\repo\node_modules", [string]$TestUser = "orbit-test")
$ErrorActionPreference = "Stop"
$T = "C:\orbit-test"
@{ req = $Req; bundle = $Bundle; out = $Out; modules = $Modules } | ConvertTo-Json | Set-Content -LiteralPath "$T\run\current.json" -Encoding UTF8
$started = (Get-Date).AddSeconds(-2)
schtasks.exe /Run /TN "ORBIT Test Runner" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "couldn't start the ORBIT Test Runner task" }
$res = $null
try {
  $deadline = (Get-Date).AddMinutes(65)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $ti = Get-ScheduledTaskInfo -TaskName "ORBIT Test Runner" -ErrorAction SilentlyContinue
    if ($ti -and $ti.LastRunTime -gt $started -and (Get-ScheduledTask -TaskName "ORBIT Test Runner").State -eq "Ready") { $res = $ti.LastTaskResult; break }
  }
} finally {
  # Nothing a test started may keep running (a server, a browser, a stray child) after its result is in.
  schtasks.exe /End /TN "ORBIT Test Runner" 2>$null | Out-Null
  Get-CimInstance Win32_Process | Where-Object { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue).User -eq $TestUser } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
if (-not (Test-Path -LiteralPath $Out)) { throw "the ORBIT Test Runner task ended without a result (task result $res)" }
