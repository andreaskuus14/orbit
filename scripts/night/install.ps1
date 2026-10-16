# Installs the ORBIT night run: a Scheduled Task, "ORBIT night run", that wakes the PC every day at -At (default 04:30)
# and runs orbit-night.ps1. Runs as you, only while you're signed in (the PC may be locked or asleep, not signed out or
# shut down); that needs no stored password and no admin rights. Re-run to change the time.
param([string]$At = "04:30")
$ErrorActionPreference = "Stop"
$taskName = "ORBIT night run"
try { $time = [datetime]::ParseExact($At, "HH:mm", [Globalization.CultureInfo]::InvariantCulture) }
catch { Write-Host "-At must be a 24-hour time like 04:30 (got '$At')." -ForegroundColor Red; exit 1 }

$script = Join-Path $PSScriptRoot "orbit-night.ps1"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $time
# No -StartWhenAvailable: a run missed because the PC was off should not start (and sleep the PC) in the morning.
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 5) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$null = Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "ORBIT: wake the PC, run the Video Scout and clip jobs, then sleep again (scripts\night)" -Force
Write-Host "Installed '$taskName': wakes the PC daily at $($time.ToString('HH:mm')). Log: $(Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'orbit-night.log')"
Write-Host ""
Write-Host "Make sure wake timers are allowed (check: powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE  -> AC index 0x00000001)."
Write-Host "To allow them:  powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1;  powercfg /SETACTIVE SCHEME_CURRENT"
Write-Host "Leave the PC asleep (not shut down) and signed in. Test now: schtasks /run /tn `"$taskName`""
