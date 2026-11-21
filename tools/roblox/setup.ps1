# ORBIT Roblox file tools: one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\roblox\setup.ps1
# Safe to run again. UNTESTED on Windows: written in a cloud box. Close Roblox Studio first (the plugin install writes to its Plugins folder).
#   Rokit  = installs and pins Roblox command-line tools (the current replacement for Aftman/Foreman).
#   Rojo   = copies scripts between files on your PC and Roblox Studio (export + live sync).
#   Selene = checks Luau code for mistakes (undefined names, unused variables, shadowing...).
#   StyLua = keeps Luau code tidy (spacing, layout).
# Licences: Rokit MIT, Rojo MPL-2.0, Selene MPL-2.0, StyLua MPL-2.0 (all free for commercial use).
#   Git    = keeps every exported version so you can see what changed.
$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$RokitVer = "1.2.0"
$RokitSha = "f9ba1704014ff67d51e8005f605955c7c26d2429a5312a9419dc477fc310e96d"  # rokit-1.2.0-windows-x86_64.zip
$RokitBin = Join-Path $HOME ".rokit\bin"

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') failed ($LASTEXITCODE)" } }

Step "Git"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is missing. Install it (winget install Git.Git), open a new PowerShell and run this again." }
git --version

Step "Rokit $RokitVer (tool manager)"
if (-not (Test-Path (Join-Path $RokitBin "rokit.exe")) -and -not (Get-Command rokit -ErrorAction SilentlyContinue)) {
  $tmp = Join-Path $env:TEMP "orbit-rokit"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zip = Join-Path $tmp "rokit.zip"
  Invoke-WebRequest "https://github.com/rojo-rbx/rokit/releases/download/v$RokitVer/rokit-$RokitVer-windows-x86_64.zip" -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $RokitSha) { throw "The Rokit download doesn't match its checksum. Not installing it." }
  Expand-Archive $zip -DestinationPath $tmp -Force
  Run (Join-Path $tmp "rokit.exe") @("self-install")  # puts rokit + tool shims in %USERPROFILE%\.rokit\bin and adds that to PATH
} else { Write-Host "Rokit is already installed." }
$env:Path = "$RokitBin;$env:Path"  # this window doesn't see the new PATH yet

Step "Rojo, Selene and StyLua (versions from tools\roblox\rokit.toml)"
Push-Location $Here
try {
  Run rokit @("install", "--no-trust-check")
  Run rojo @("--version")
  Run selene @("--version")
  Run stylua @("--version")
  # Also as global tools, so they run in a connected folder that pins other tools (its own aftman.toml/rokit.toml). Not fatal.
  foreach ($t in @("rojo-rbx/rojo@7.7.1", "Kampfkarren/selene@0.31.0", "JohnnyMorganz/StyLua@2.6.0")) {
    & rokit add --global $t 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "  ($t is already a global tool, or Rokit said no: fine)" }
  }
  Step "Rojo's Studio plugin"
  Run rojo @("plugin", "install")
} finally { Pop-Location }

Write-Host "`nDone. Restart Roblox Studio (Plugins tab -> Rojo) and restart ORBIT, then open GAME DEV -> Build -> Files." -ForegroundColor Green
