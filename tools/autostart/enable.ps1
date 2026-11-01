# Starts ORBIT's server (no window) every time you sign in to Windows: a per-user Task Scheduler task "ORBIT" that runs
# scripts\launch.ps1 -ServerOnly, the same production server "npm run app:start" starts. No admin rights: the task runs as
# you, only while you're signed in. If Windows refuses the task, it falls back to a Startup-folder shortcut.
# Run from the ORBIT folder:  powershell -ExecutionPolicy Bypass -File tools\autostart\enable.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$launcher = Join-Path $root "scripts\launch.ps1"
$taskName = "ORBIT"
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT server.lnk" # the older way (scripts\install-shortcut.ps1 -Autostart)
$me = "$env:USERDOMAIN\$env:USERNAME"

try {
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ServerOnly" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me # only your own sign-in: that needs no admin
  $trigger.Delay = "PT30S" # let the desktop settle first
  # No time limit: the launcher returns once the server answers (longer after an update, when it builds first).
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  $null = Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "ORBIT: start the ORBIT server when you sign in (tools\autostart)" -Force
  Remove-Item -LiteralPath $startup -ErrorAction SilentlyContinue # one way is enough
  Write-Host "Starts with Windows: ON (Task Scheduler task '$taskName', at your sign-in). Turn off: tools\autostart\disable.ps1"
} catch {
  Write-Host "Task Scheduler refused ($($_.Exception.Message)); using a Startup-folder shortcut instead."
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
  $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ServerOnly"
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$root\public\orbit.ico,0"
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Starts with Windows: ON (Startup shortcut $startup). Turn off: tools\autostart\disable.ps1"
}
