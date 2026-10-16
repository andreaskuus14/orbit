# ORBIT night run

Every night Windows wakes the PC, ORBIT starts (server only, no window), the Video Scout runs and the clips it queues
download and render, and when nothing has been busy for 10 minutes the PC goes back to sleep.

| Command | What it does |
|---|---|
| `npm run night:install` | Create the Scheduled Task "ORBIT night run" (daily 04:30, wakes the PC) |
| `npm run night:install -- -At 05:15` | Same, at another time (24-hour). Re-run to change it |
| `npm run night:uninstall` | Remove the task |
| `schtasks /run /tn "ORBIT night run"` | Run it now (to test; it won't sleep the PC while you use it) |

## Requirements

- The PC must be **asleep, not shut down**, and you must be **signed in** (locked is fine). The task runs as you,
  "only when the user is logged on": that needs no stored password and no admin rights. ("Run whether the user is
  logged on or not" would need your password stored in Task Scheduler, or S4U, which needs admin rights and has no
  access to your saved credentials, so it isn't used.)
- **Wake timers must be allowed** in the power plan. Check (look for `Current AC Power Setting Index: 0x00000001`):

      powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE

  Enable:

      powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
      powercfg /SETACTIVE SCHEME_CURRENT

  `powercfg /waketimers` shows the timer while the PC is set to wake.
- A **laptop on battery** may not wake (wake timers are often off on battery, use `SETDCVALUEINDEX` for that).
  Some PCs also need wake timers / "wake on RTC" enabled in the BIOS.

## What it does (scripts\night\orbit-night.ps1)

1. Starts ORBIT with `scripts\launch.ps1 -ServerOnly` if it isn't running (same as the wake listener).
2. Keeps the PC awake while it works (`SetThreadExecutionState`); otherwise Windows re-sleeps an unattended wake after ~2 min.
3. Every minute asks `http://127.0.0.1:3000/api/studio/busy` (no login, localhost only, returns only booleans:
   clip jobs or renders running/queued, downloads running/queued, scout running, upload running, and `scoutPending`).
4. Sleeps the PC when nothing was busy for 10 min, at least 20 min after the start; at most 4 h after the start.
   If the PC was used in the last 10 min it doesn't sleep: it exits and leaves ORBIT running.

**How the scout gets run:** the "Run scout now" route needs a login, so the night run doesn't call it. It relies on the
scout's own schedule: ORBIT checks ~1 min after start and every 5 min, and runs the scout once the day's `runAt` hour
(default 06:00) is reached. `scoutPending` (today's run not done yet, `runAt` at most 4 h away, YouTube key and
creators/keywords set) counts as busy, so with the default 04:30 the PC stays awake until the 06:00 run, then for its
downloads and renders. Set the night time 1-4 h before `runAt` on the same day (don't cross midnight: a 22:00 night time with a 01:00 `runAt` won't wait), or after it (then the scout runs ~1 min after start).

Log: `orbit-night.log` in the ORBIT folder (moved to `.1` above 1 MB).
