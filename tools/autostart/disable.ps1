# Stops ORBIT starting with Windows: removes the "ORBIT" sign-in task and the older Startup shortcut. ORBIT keeps running now;
# stop it with npm run app:stop.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "ORBIT server.lnk"
if (Get-ScheduledTask -TaskName "ORBIT" -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName "ORBIT" -Confirm:$false; Write-Host "Removed the Task Scheduler task 'ORBIT'." }
if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup; Write-Host "Removed $startup" }
Write-Host "Starts with Windows: OFF. ORBIT itself is still running in $root (stop it: npm run app:stop)."
