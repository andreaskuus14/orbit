# ORBIT + Blender: one-time setup on Windows (PowerShell). Run from the ORBIT folder:
#   powershell -ExecutionPolicy Bypass -File tools\blender\setup.ps1
# Safe to run again. UNTESTED on Windows: written in a cloud box, so read what each step prints. Close Blender first.
#   Blender      = free 3D program (the LTS = long-term-support version, gets bug fixes for 2 years).
#   uv           = installs small Python programs in their own sandbox folder (needed for blender-mcp).
#   blender-mcp  = the bridge: a program ORBIT talks to (MCP) that passes commands to Blender's add-on on port 9876 (this PC only).
#   the add-on   = blender-mcp's part inside Blender (addon.py): a BlenderMCP tab in the N sidebar with a Connect button.
#   Bonsai       = free BIM add-on for Blender: opens, inspects and edits IFC building models (ARCH).
#   plugins.json = ORBIT's plugin list on this PC (never in git); this adds "blender" with safe defaults.
$ErrorActionPreference = "Stop"
$Lts = @("5.2", "4.5")  # newest LTS first; 5.2 LTS came out July 2026 (support to 2028), 4.5 is the fallback
$AddonUrl = "https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py"

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Find-Blender {
  Get-ChildItem "$env:ProgramFiles\Blender Foundation\*\blender.exe" -ErrorAction SilentlyContinue |
    Sort-Object { $_.Directory.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName  # "Blender 5.2" before "Blender 4.5"
}

Step "winget (Windows package installer)"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again." }

Step "Blender LTS"
$blender = Find-Blender
if ($blender) { Write-Host "Blender is already installed: $blender" } else {
  foreach ($v in $Lts) {
    Write-Host "Trying winget package BlenderFoundation.Blender.LTS.$v ..."
    winget install --id "BlenderFoundation.Blender.LTS.$v" -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0 -and ($blender = Find-Blender)) { break }
  }
  if (-not $blender) { throw "Couldn't install Blender with winget. Install the LTS from blender.org/download/lts, then run this again." }
}
& $blender --version | Select-Object -First 1

Step "uv (runs blender-mcp)"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
  $env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$HOME\.local\bin;$env:Path"  # this window doesn't see the new PATH yet
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw "uv installed but isn't on PATH yet. Open a new PowerShell and run this again." }
}
uv --version

Step "blender-mcp (the bridge ORBIT talks to)"
# Installed once (not 'uvx' on every call), so ORBIT's Test connection doesn't wait for a download.
uv tool install --upgrade blender-mcp
if ($LASTEXITCODE -ne 0) { throw "uv tool install blender-mcp failed." }
$mcpExe = Join-Path (uv tool dir --bin) "blender-mcp.exe"
if (-not (Test-Path $mcpExe)) { throw "blender-mcp.exe not found at $mcpExe" }
Write-Host "blender-mcp: $mcpExe"
# blender-mcp's telemetry: with it on, its terms give the maintainer a license to your prompts, code and screenshots. Off for this user.
[Environment]::SetEnvironmentVariable("DISABLE_TELEMETRY", "true", "User")
$env:DISABLE_TELEMETRY = "true"

Step "The BlenderMCP add-on inside Blender"
$tmp = Join-Path $env:TEMP "orbit-blender"
New-Item -ItemType Directory -Force $tmp | Out-Null
$addon = Join-Path $tmp "addon.py"
Invoke-WebRequest $AddonUrl -OutFile $addon -UseBasicParsing
# Unpinned (the project publishes no checksums): this is the same file its README tells you to download. The hash is for your notes.
Write-Host "addon.py SHA256: $((Get-FileHash $addon -Algorithm SHA256).Hash)"
$py = "import bpy; bpy.ops.preferences.addon_install(filepath=r'$addon', overwrite=True); bpy.ops.preferences.addon_enable(module='addon'); bpy.ops.wm.save_userpref(); print('ORBIT: add-on enabled')"
& $blender --background --python-expr $py 2>&1 | Select-String "ORBIT:|Error" | ForEach-Object { Write-Host $_ }

Step "Bonsai (BIM / IFC) from extensions.blender.org"
& $blender --online-mode --command extension install --sync --enable bonsai
if ($LASTEXITCODE -ne 0) { & $blender --online-mode --command extension install --sync --enable --repo blender_org bonsai }
if ($LASTEXITCODE -ne 0) {
  Write-Host "Bonsai didn't install from the command line. Do it by hand (1 minute): Blender -> Edit -> Preferences -> Get Extensions -> Allow Online Access -> search 'Bonsai' -> Install." -ForegroundColor Yellow
}

Step "Register the Blender plugin in ORBIT"
$dataDir = if ($env:ORBIT_DATA_DIR) { $env:ORBIT_DATA_DIR } else { Join-Path $env:LOCALAPPDATA "orbit" }
New-Item -ItemType Directory -Force $dataDir | Out-Null
$file = Join-Path $dataDir "plugins.json"
$list = @()
if (Test-Path $file) { $list = @((Get-Content $file -Raw | ConvertFrom-Json).plugins | Where-Object { $_ -and $_.name -ne "blender" }) }
$list += [ordered]@{
  name = "blender"; command = $mcpExe; args = @(); env = [ordered]@{ DISABLE_TELEMETRY = "true" }
  enabled = $true; local = $true; timeoutSec = 180; note = "his Blender on this PC"
  # execute_blender_code can run ANY Python inside Blender (files, network): it waits for your Run click in Profile -> Plugins.
  # Poly Haven / Sketchfab download from the internet, Hyper3D / Hunyuan3D generate online (can cost credits): all off.
  tools = [ordered]@{ get_scene_info = "auto"; get_object_info = "auto"; get_viewport_screenshot = "auto"; execute_blender_code = "ask" }
  others = "off"
}
[IO.File]::WriteAllText($file, ([ordered]@{ plugins = $list } | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))  # no BOM
Write-Host "Saved $file"

Write-Host @"

Done. Every time you want ORBIT to use Blender:
  1. Open Blender. In the 3D view press N -> BlenderMCP tab. Leave Poly Haven, Hyper3D, Sketchfab and Hunyuan3D unchecked
     (and the telemetry box unchecked in Edit -> Preferences -> Add-ons -> Blender MCP). Click 'Connect to MCP server'.
  2. First time only: ORBIT -> Profile -> Plugins -> blender -> Test connection (it should list about 20 tools).
  3. GAME DEV -> Text to 3D -> Make in Blender, or ARCH -> Open in Blender / Bonsai.
Save your Blender file before you click Run on any queued code.
"@ -ForegroundColor Green
