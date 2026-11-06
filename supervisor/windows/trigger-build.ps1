# Supervisor side (SYSTEM): ask the owner-context task "ORBIT Release Build" to build exactly <commit>, wait for its result.
# Repo code never runs as SYSTEM. Exit 0 only when the stage folder reports a successful build of this commit.
param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$Stage)
$ErrorActionPreference = "Stop"
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "bad commit" }
$req = "C:\ProgramData\orbit-supervisor\public\build-request.txt" # owner can read public\, not write it
Set-Content -LiteralPath $req -Value $Commit -NoNewline
$result = Join-Path $Stage "BUILD_RESULT.txt"
Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
schtasks.exe /Run /TN "ORBIT Release Build" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "couldn't start the ORBIT Release Build task (is the owner signed in?)" }
$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (Test-Path $result) {
    $r = (Get-Content -LiteralPath $result -Raw).Trim() -split "\s+"
    if ($r[0] -ne $Commit) { throw "stage built $($r[0]), not $Commit" }
    exit ([int]$r[1])
  }
}
throw "build didn't finish in 30 minutes"
