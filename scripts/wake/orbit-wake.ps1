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

function Wake-Orbit {
  # Always through the launcher: it returns in a second or two when the server is up and current, and otherwise
  # starts or restarts it (production build, rebuilt after an update) under the restart supervisor.
  $launcher = Join-Path $root "scripts\launch.ps1"
  $p = Start-Process powershell.exe -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -ServerOnly" -WindowStyle Hidden -PassThru
  $null = $p.Handle; $p.WaitForExit() # not -Wait: in PowerShell 5.1 that also waits for the supervisor it leaves running
  if ($p.ExitCode -ne 0) { Write-Log "ERROR: ORBIT didn't start. See $(Join-Path $root 'orbit-server.log')"; return }
  if ($script:canFocus) {
    $win = [OrbitWindow]::Find()
    if ($win -ne [IntPtr]::Zero) {
      [OrbitWindow]::Focus($win)
      Write-Log "ORBIT window already open; brought it to the front."
      return
    }
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

# A fresh recognizer with the wake grammar, its event subscriptions, listening. Throws when there is no microphone.
function New-Engine {
  $e = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  try { $e.SetInputToDefaultAudioDevice() } catch { $e.Dispose(); throw }
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]@("orbit wake up", "orbital wake up", "hey orbit wake up", "orbit wake"))
  $gb = New-Object System.Speech.Recognition.GrammarBuilder
  $gb.Culture = $info.Culture
  $gb.Append($choices)
  $wake = New-Object System.Speech.Recognition.Grammar($gb)
  $wake.Name = "wake"
  $e.LoadGrammar($wake)
  # Optional dictation grammar to soak up ordinary speech. Off by default: with non-native accents dictation "wins"
  # the wake phrase too (e.g. "orbit wake up" heard as "all are the way up"), so nothing ever triggers.
  if ($Dictation) { try { $e.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)) } catch { } }
  # Always on: audio level events are the heartbeat the watchdog below uses to spot a silently dead microphone.
  Register-ObjectEvent -InputObject $e -EventName AudioLevelUpdated -SourceIdentifier "orbit.level" | Out-Null
  Register-ObjectEvent -InputObject $e -EventName SpeechRecognized -SourceIdentifier "orbit.heard" | Out-Null
  Register-ObjectEvent -InputObject $e -EventName RecognizeCompleted -SourceIdentifier "orbit.done" | Out-Null
  $e.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  return $e
}

# Drops the current recognizer, its subscriptions (so New-Engine can reuse the identifiers) and its queued events.
function Remove-Engine {
  foreach ($id in "orbit.level", "orbit.heard", "orbit.done") {
    try { Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue } catch { }
    try { Remove-Event -SourceIdentifier $id -ErrorAction SilentlyContinue } catch { }
  }
  if ($script:engine) { try { $script:engine.Dispose() } catch { } }
  $script:engine = $null
}

# Start listening again, retrying with a growing pause until a microphone is there. -Rebuild replaces the recognizer.
function Connect-Listener([switch]$Rebuild, [switch]$Quiet) {
  if ($Rebuild) { Remove-Engine }
  $wait = 2
  while ($true) {
    Start-Sleep -Seconds $wait
    try {
      if ($Rebuild) { $script:engine = New-Engine }
      else {
        $script:engine.SetInputToDefaultAudioDevice()
        $script:engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
      }
      if (-not $Quiet) { Write-Log "Listening again." }
      $script:lastAudio = Get-Date
      return
    } catch {
      if ($wait -eq 2) { Write-Log "No microphone yet ($($_.Exception.Message)); will keep retrying." }
      $wait = [math]::Min($wait * 2, 60)
    }
  }
}

try {
  try { Add-Type -AssemblyName System.Speech } catch { Write-Log "ERROR: System.Speech isn't available on this PC (needs Windows with .NET Framework)."; exit 2 }

  # Finds an open ORBIT window (Chrome/Edge window class; title is the page title "ORBIT", or "ORBIT - Google Chrome"
  # for a tab) so a wake can bring it forward instead of opening a second one.
  $script:canFocus = $false
  try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OrbitWindow {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static IntPtr Find() {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      StringBuilder t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (!t.ToString().StartsWith("ORBIT", StringComparison.Ordinal)) return true;
      found = h; return false;
    }, IntPtr.Zero);
    return found;
  }
  public static void Focus(IntPtr h) {
    ShowWindow(h, IsIconic(h) ? 9 : 5); // SW_RESTORE : SW_SHOW
    // Windows refuses SetForegroundWindow from a background process (it only flashes the taskbar) unless a key
    // event just happened: a lone Alt tap lifts that lock.
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }
}
"@
    $script:canFocus = $true
  } catch { Write-Log "WARNING: can't look for an open ORBIT window ($($_.Exception.Message)); each wake opens a new one." }

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

  if ($DebugRun) {
    Write-Host "DEBUG: printing everything heard (not logged). Talk normally, then say 'orbit wake up'. Ctrl+C to stop." -ForegroundColor Cyan
  }
  try { $script:engine = New-Engine } catch {
    Write-Log "ERROR: no microphone available ($($_.Exception.Message)). Plug one in and check Settings > Privacy > Microphone > 'Let desktop apps access your microphone'."
    exit 4
  }
  # Loose on purpose: dictation often hears "orbit" as "or bit", "orbits", "orbital", "a bit" and "wake up" as "wake-up"/"wakeup".
  $phrase = '\b(orbit|orbits|orbital|orbitals|or bit|orb it|our bit|orbed)\s+(\w+\s+)?(wake|wakes|woke|wake up|wakeup)\b'
  Write-Log "Listening for 'orbital wake up' (recognizer $($info.Culture.Name), min confidence $MinConfidence, pid $PID)."

  $last = [datetime]::MinValue
  $lastLevel = [datetime]::MinValue
  $script:lastAudio = Get-Date
  $cancelAt = $null # when the watchdog cancelled recognition; "orbit.done" should follow
  # Silence before each watchdog restart. A quiet room may send no level events at all, so restarts that bring none
  # back wait longer each time instead of restarting (and logging) every minute forever.
  $silenceSteps = @(60, 300, 900)
  $silentRestarts = 0
  while ($true) {
    $ev = Wait-Event -Timeout 15
    if (-not $ev) {
      if ($cancelAt -and ((Get-Date) - $cancelAt).TotalSeconds -ge 15) {
        # The cancel never completed: the recognizer itself is wedged, so build a new one.
        Write-Log "The listener didn't stop after 15 s; rebuilding the recognizer."
        $cancelAt = $null
        Connect-Listener -Rebuild
        continue
      }
      # Watchdog: after a screen lock / user switch / sleep, Windows can hand the recognizer a dead audio stream that
      # never errors. No level events for a while means no audio: cancel, which fires "orbit.done" and reconnects below.
      $limit = $silenceSteps[[math]::Min($silentRestarts, $silenceSteps.Count - 1)]
      if (-not $cancelAt -and ((Get-Date) - $script:lastAudio).TotalSeconds -ge $limit) {
        $silentRestarts++
        if ($silentRestarts -le $silenceSteps.Count) {
          $next = $silenceSteps[[math]::Min($silentRestarts, $silenceSteps.Count - 1)]
          Write-Log ("No audio from the microphone for {0} s; restarting the listener (next check after {1} s of silence{2})." -f $limit, $next, $(if ($silentRestarts -eq $silenceSteps.Count) { "; not logged again until audio returns" } else { "" }))
        }
        $script:lastAudio = Get-Date
        $cancelAt = Get-Date
        try { $script:engine.RecognizeAsyncCancel() } catch { }
      }
      continue
    }
    Remove-Event -EventIdentifier $ev.EventIdentifier
    if ($ev.SourceIdentifier -eq "orbit.done") {
      # The mic dropped (unplugged, switched device, another app took it, PC woke from sleep): reconnect instead of
      # dying, retrying with a growing pause, so the listener survives without a restart.
      $err = $ev.SourceEventArgs.Error
      $watchdog = [bool]$cancelAt # the watchdog already logged this restart
      $cancelAt = $null
      if (-not $watchdog) { Write-Log "Audio input stopped ($(if ($err) { $err.Message } else { 'microphone disconnected?' })); reconnecting." }
      Connect-Listener -Quiet:$watchdog
      continue
    }
    if ($ev.SourceIdentifier -eq "orbit.level") { # proves the mic reaches the recognizer
      $script:lastAudio = Get-Date
      $silentRestarts = 0
      if ($DebugRun -and ((Get-Date) - $lastLevel).TotalSeconds -ge 1) { $lastLevel = Get-Date; Write-Host ("  mic level {0,3} {1}" -f $ev.SourceEventArgs.AudioLevel, ("#" * [math]::Ceiling($ev.SourceEventArgs.AudioLevel / 5))) }
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
