# Supervisor side (SYSTEM): ask the owner-context task "ORBIT Release Install" to install <commit> from the snapshot <dist>,
# wait for its result. SYSTEM never runs git or scripts inside the owner-writable live folder.
param([Parameter(Mandatory)][string]$Commit, [Parameter(Mandatory)][string]$Dist, [Parameter(Mandatory)][string]$Results)
$ErrorActionPreference = "Stop"
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw "bad commit" }
$home_ = "C:\ProgramData\orbit-supervisor"
if (-not ([IO.Path]::GetFullPath($Dist)).StartsWith("$home_\releases\", [StringComparison]::OrdinalIgnoreCase)) { throw "dist must be a retained snapshot" }
Set-Content -LiteralPath "$home_\public\install-request.txt" -Value "$Commit`n$Dist" -NoNewline
$result = Join-Path $Results "INSTALL_RESULT.txt"
Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
schtasks.exe /Run /TN "ORBIT Release Install" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "couldn't start the ORBIT Release Install task (is the owner signed in?)" }
$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-Path $result) {
    $r = (Get-Content -LiteralPath $result -Raw).Trim() -split "\s+", 3
    if ($r[0] -ne $Commit) { throw "installed $($r[0]), not $Commit" }
    if ($r[1] -ne "0") { throw "install failed: $($r[2])" }
    exit 0
  }
}
throw "install didn't finish in 10 minutes"
