# Creates "ORBIT" shortcuts on the Desktop and in the Start menu that run the launcher.
# -Autostart: also start the ORBIT server (no window) every time you sign in to Windows. -RemoveAutostart undoes it.
param([switch]$Autostart, [switch]$RemoveAutostart)
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath("Desktop"), (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir "ORBIT.lnk"))
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`""
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$root\public\orbit.ico,0"
  $lnk.Description = "ORBIT - your mind has a universe"
  $lnk.WindowStyle = 7  # minimized: no console flash
  $lnk.Save()
  Write-Host "Created $(Join-Path $dir 'ORBIT.lnk')"
}
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT server.lnk"
if ($RemoveAutostart) { Remove-Item $startup -ErrorAction SilentlyContinue; Write-Host "Auto-start removed." }
elseif ($Autostart) {
  $lnk = $shell.CreateShortcut($startup)
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`" -ServerOnly"
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$root\public\orbit.ico,0"
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Auto-start on: the ORBIT server will start every time you sign in to Windows."
}
Write-Host "Done. Double-click ORBIT on your desktop or search 'ORBIT' in the Start menu."
