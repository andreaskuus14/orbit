# Removes the ORBIT night run Scheduled Task. Leaves ORBIT itself and orbit-night.log alone.
$taskName = "ORBIT night run"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed '$taskName'."
} else { Write-Host "'$taskName' isn't installed." }
