# ORBIT wake listener: say "orbital wake up" and ORBIT opens with CORE greeting you.
# Offline Windows speech recognition (System.Speech). No audio is stored or sent anywhere.
# Exit codes: 0 already running, 2 System.Speech missing, 3 no recognizer, 4 no microphone at start.
param(
  [double]$MinConfidence = 0.5, # the wake grammar only knows the wake phrases, so modest confidence is enough
  [switch]$DebugRun,             # wake:debug - print everything heard to this window (never to the log), ignore a background listener
  [switch]$Dictation,            # stricter: also load free dictation (fewer false triggers, but misses accented speech)
  [int]$CooldownSeconds = 10,
  [string]$Url = "http://localhost:3000"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest's progress bar is slow and pointless when hidden
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dataDir = Join-Path $env:LOCALAPPDATA "orbit-wake"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$logFile = Join-Path $dataDir "wake.log"
$pidFile = Join-Path $dataDir "pid"

function Write-Log([string]$msg) {
  try {
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 200KB) { Move-Item $logFile "$logFile.1" -Force }
    Add-Content -Path $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg)
  } catch { }
  Write-Host $msg
}

# One listener at a time (the Startup shortcut and install.ps1 may both start one).
$mutex = New-Object System.Threading.Mutex($false, "Local\orbit-wake")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned -and -not $DebugRun) { Write-Log "Another ORBIT wake listener is already running; exiting."; exit 0 }
if (-not $DebugRun) { Set-Content -Path $pidFile -Value $PID }

function Test-Orbit {
  try { (Invoke-WebRequest "$Url/login" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $false }
}

function Wake-Orbit {
  if (-not (Test-Orbit)) {
    # Same start-up as the desktop shortcut: production build (rebuilt if needed) under the restart supervisor.
    Write-Log "ORBIT server not answering; running scripts\launch.ps1 -ServerOnly (may build first, up to 10 min)."
    $launcher = Join-Path $root "scripts\launch.ps1"
    $p = Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ServerOnly" -WindowStyle Hidden -PassThru
    $null = $p.Handle; $p.WaitForExit() # not -Wait: in PowerShell 5.1 that also waits for the supervisor it leaves running
    if ($p.ExitCode -ne 0) { Write-Log "ERROR: ORBIT didn't start. See $(Join-Path $root 'orbit-server.log')"; return }
    Write-Log "ORBIT server is up."
  }
  $target = "$Url/?wake=1"
  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($chrome) {
    # The autoplay flag lets CORE speak without a click, but Chrome only honours it when Chrome isn't already running.
    Start-Process $chrome "--app=$target --autoplay-policy=no-user-gesture-required"
    Write-Log "Opened ORBIT in Chrome app window."
  } else {
    Start-Process $target
    Write-Log "Chrome not found; opened ORBIT in the default browser."
  }
}

try {
  try { Add-Type -AssemblyName System.Speech } catch { Write-Log "ERROR: System.Speech isn't available on this PC (needs Windows with .NET Framework)."; exit 2 }

  # The phrases are English: prefer an English recognizer matching the Windows language, then en-US, then any English one.
  $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($installed.Count -eq 0) { Write-Log "ERROR: no speech recognizer installed. Settings > Time & language > Speech: add English (United States) speech."; exit 3 }
  $ui = [Globalization.CultureInfo]::CurrentUICulture.Name
  $info = $installed | Where-Object { $_.Culture.Name -eq $ui -and $_.Culture.TwoLetterISOLanguageName -eq "en" } | Select-Object -First 1
  if (-not $info) { $info = $installed | Where-Object { $_.Culture.Name -eq "en-US" } | Select-Object -First 1 }
  if (-not $info) { $info = $installed | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq "en" } | Select-Object -First 1 }
  if (-not $info) {
    $info = $installed[0]
    Write-Log "WARNING: no English recognizer; using $($info.Culture.Name), which may not understand the English wake phrase. Add English (United States) speech in Windows settings."
  }

  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  try { $engine.SetInputToDefaultAudioDevice() } catch {
    Write-Log "ERROR: no microphone available ($($_.Exception.Message)). Plug one in and check Settings > Privacy > Microphone > 'Let desktop apps access your microphone'."
    exit 4
  }

  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]@("orbit wake up", "orbital wake up", "hey orbit wake up", "orbit wake"))
  $gb = New-Object System.Speech.Recognition.GrammarBuilder
  $gb.Culture = $info.Culture
  $gb.Append($choices)
  $wake = New-Object System.Speech.Recognition.Grammar($gb)
  $wake.Name = "wake"
  $engine.LoadGrammar($wake)
  # Optional dictation grammar to soak up ordinary speech. Off by default: with non-native accents dictation "wins"
  # the wake phrase too (e.g. "orbit wake up" heard as "all are the way up"), so nothing ever triggers.
  if ($Dictation) { try { $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)) } catch { } }
  # Loose on purpose: dictation often hears "orbit" as "or bit", "orbits", "orbital", "a bit" and "wake up" as "wake-up"/"wakeup".
  $phrase = '\b(orbit|orbits|orbital|orbitals|or bit|orb it|our bit|orbed)\s+(\w+\s+)?(wake|wakes|woke|wake up|wakeup)\b'
  if ($DebugRun) {
    Register-ObjectEvent -InputObject $engine -EventName AudioLevelUpdated -SourceIdentifier "orbit.level" | Out-Null
    Write-Host "DEBUG: printing everything heard (not logged). Talk normally, then say 'orbit wake up'. Ctrl+C to stop." -ForegroundColor Cyan
  }

  Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier "orbit.heard" | Out-Null
  Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -SourceIdentifier "orbit.done" | Out-Null
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Write-Log "Listening for 'orbital wake up' (recognizer $($info.Culture.Name), min confidence $MinConfidence, pid $PID)."

  $last = [datetime]::MinValue
  $lastLevel = [datetime]::MinValue
  while ($true) {
    $ev = Wait-Event
    Remove-Event -EventIdentifier $ev.EventIdentifier
    if ($ev.SourceIdentifier -eq "orbit.done") {
      # The mic dropped (unplugged, switched device, another app took it, PC woke from sleep): reconnect instead of
      # dying, retrying with a growing pause, so the listener survives without a restart.
      $err = $ev.SourceEventArgs.Error
      Write-Log "Audio input stopped ($(if ($err) { $err.Message } else { 'microphone disconnected?' })); reconnecting."
      $wait = 2
      while ($true) {
        Start-Sleep -Seconds $wait
        try {
          $engine.SetInputToDefaultAudioDevice()
          $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
          Write-Log "Listening again."
          break
        } catch {
          if ($wait -eq 2) { Write-Log "No microphone yet ($($_.Exception.Message)); will keep retrying." }
          $wait = [math]::Min($wait * 2, 60)
        }
      }
      continue
    }
    if ($ev.SourceIdentifier -eq "orbit.level") { # proves the mic reaches the recognizer
      if (((Get-Date) - $lastLevel).TotalSeconds -ge 1) { $lastLevel = Get-Date; Write-Host ("  mic level {0,3} {1}" -f $ev.SourceEventArgs.AudioLevel, ("#" * [math]::Ceiling($ev.SourceEventArgs.AudioLevel / 5))) }
      continue
    }
    if ($ev.SourceIdentifier -ne "orbit.heard") { continue }
    $r = $ev.SourceEventArgs.Result
    $text = (($r.Text.ToLowerInvariant() -replace "[^a-z ]", " ") -replace "\s+", " ").Trim()
    if ($DebugRun) { Write-Host ("  heard '{0}'  grammar={1}  confidence={2:N2}" -f $text, $r.Grammar.Name, $r.Confidence) }
    if ($r.Grammar.Name -ne "wake" -and $text -notmatch $phrase) { continue }
    if ($r.Confidence -lt $MinConfidence) { Write-Log ("Heard '{0}' at confidence {1:N2} (below {2}); ignored." -f $text, $r.Confidence, $MinConfidence); continue }
    if (((Get-Date) - $last).TotalSeconds -lt $CooldownSeconds) { continue }
    $last = Get-Date
    Write-Log ("Wake phrase '{0}' (confidence {1:N2})." -f $text, $r.Confidence)
    try { Wake-Orbit } catch { Write-Log "ERROR while opening ORBIT: $($_.Exception.Message)" }
    $last = Get-Date # cooldown counts from when ORBIT opened, not from when the server started booting
  }
} finally {
  if (-not $DebugRun) { Remove-Item $pidFile -ErrorAction SilentlyContinue }
  if ($owned) { $mutex.ReleaseMutex() }
}
