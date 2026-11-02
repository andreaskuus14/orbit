# Start ORBIT with Windows

    powershell -ExecutionPolicy Bypass -File tools\autostart\enable.ps1    # on
    powershell -ExecutionPolicy Bypass -File tools\autostart\disable.ps1   # off

`enable.ps1` registers a per-user Task Scheduler task **ORBIT**: 30 s after you sign in it runs
`scripts\launch.ps1 -ServerOnly` hidden, the same production server `npm run app:start` starts (it builds first only if
the code changed since the last build). It runs as you, only while you're signed in, so it needs no admin rights and no
stored password. If Windows refuses the task, it falls back to a shortcut in your Startup folder (what
`npm run app:autostart` made before). OPERATIONS → Local AI shows "Starts with Windows: on/off" with a button that runs
these same two scripts.

## Waking the PC for scheduled jobs

A sign-in task can't wake the PC. "Wake the computer to run this task" is a documented Task Scheduler setting
(`-WakeToRun`) that needs no admin for your own task: ORBIT already uses it in the night run (`npm run night:install`,
see `scripts\night\README.md`), which wakes the PC at a set time, starts ORBIT and lets it sleep again. Wake timers must
be allowed in the power plan (`powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE`); on battery a laptop often won't wake.
