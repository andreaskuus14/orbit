# Stops the background ORBIT server (only the process listening on port 3000).
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; Write-Host "ORBIT server stopped." } else { Write-Host "ORBIT server isn't running." }
