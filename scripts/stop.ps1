# Stops ORBIT: first the supervisor (so nothing restarts the server), then every ORBIT server process,
# however it was started (launcher, wake listener, or "npm run dev" in a terminal).
# Only processes proven to be this ORBIT's are killed: their command line (or a parent's) names this folder plus the
# launcher, npm or Next. Something else listening on port 3000 is reported and left running.
$ErrorActionPreference = "Continue" # launch.ps1 calls this with "Stop", which would turn taskkill's stderr into a crash
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "orbit-server.pid" # written by launch.ps1's supervisor: its PID and the server's
$stopped = 0

function Get-Processes {
  $all = @{}
  Get-CimInstance Win32_Process | ForEach-Object { $all[[int]$_.ProcessId] = $_ }
  $all
}

# The command line names this ORBIT folder and the launcher, npm or Next (not just any program opened on the folder).
function Test-OrbitCommand($p) {
  [bool]($p -and $p.CommandLine -and $p.CommandLine.IndexOf("$root\", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $p.CommandLine -match 'launch\.ps1|npm|next')
}

# True when $match holds for the process or one of its parents.
function Test-Ancestry([int]$id, [scriptblock]$match) {
  $child = $null
  for ($i = 0; $i -lt 12; $i++) {
    $p = $procs[$id]
    # Stop at a parent that's gone, or a reused PID (a "parent" started after its child).
    if (-not $p -or ($child -and $p.CreationDate -gt $child.CreationDate)) { return $false }
    if (& $match $p) { return $true }
    $child = $p
    $id = [int]$p.ParentProcessId
  }
  return $false
}

# ORBIT's own (covers a Next.js installed outside this folder: its parent is the supervisor's
# "cmd /c npm.cmd run start >> <this folder>\orbit-server.log").
function Test-OrbitProcess([int]$id) { Test-Ancestry $id { param($p) Test-OrbitCommand $p } }

# Part of a "next build" (the build itself or its workers): the launcher swaps it in when it finishes.
function Test-BuildProcess([int]$id) { Test-Ancestry $id { param($p) (Test-OrbitCommand $p) -and $p.CommandLine -match ' build( |"|$)' } }

function Stop-Tree([int]$id) {
  if ($id -eq $PID) { return }
  taskkill.exe /PID $id /T /F 2>&1 | Out-Null # /T also ends cmd -> npm -> next children
  if ($LASTEXITCODE -eq 0) { $script:stopped++ }
}

$procs = Get-Processes

# The PIDs the supervisor recorded, if they're still ORBIT's (a PID can be reused by another program).
if (Test-Path $pidFile) {
  foreach ($line in @(Get-Content $pidFile -ErrorAction SilentlyContinue)) {
    $id = 0
    if ([int]::TryParse("$line".Trim(), [ref]$id) -and (Test-OrbitCommand $procs[$id])) { Stop-Tree $id }
  }
}

# Any hidden supervisor from this folder (launch.ps1 -Supervise), e.g. if the PID file is missing.
$procs.Values | Where-Object { $_.Name -match '^(powershell|pwsh)\.exe$' -and $_.CommandLine -like '*launch.ps1*-Supervise*' -and (Test-OrbitCommand $_) } |
  ForEach-Object { Stop-Tree $_.ProcessId }

# Any Next.js process running from this folder (node ...\orbit\node_modules\...\next\dist\...).
$procs.Values | Where-Object { $_.Name -eq 'node.exe' -and (Test-OrbitCommand $_) -and $_.CommandLine -match '\\next\\dist\\' -and -not (Test-BuildProcess $_.ProcessId) } |
  ForEach-Object { Stop-Tree $_.ProcessId }

# Last: whatever still listens on port 3000, only if it's ORBIT's.
Start-Sleep -Seconds 1
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $procs = Get-Processes
  $owner = [int]$conn.OwningProcess
  if (Test-OrbitProcess $owner) { Stop-Tree $owner }
  else {
    $name = if ($procs[$owner]) { $procs[$owner].Name } else { "unknown" }
    Write-Host "Port 3000 is used by '$name' (PID $owner), which isn't this ORBIT; left it running. ORBIT can't start until it's closed."
  }
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
if ($stopped -gt 0) { Write-Host "ORBIT stopped." } else { Write-Host "ORBIT isn't running." }
