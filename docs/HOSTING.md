# Running ORBIT on an always-on host

Investigation, 2026-11-07, against main `02b6c8f`. Nothing here is built yet; each gap below is a separate task with its own PR.
File references are to that commit.

## Recommendation

**An always-on Windows mini-PC, not a Linux VPS.** ORBIT assumes Windows and one signed-in user in many places. On Windows,
most of that keeps working; on Linux it is a port. For the reasons, see *Why not a VPS* below.

The mini-PC should run the server only (`launch.ps1 -ServerOnly`). The desktop extras (app window, wake word, Blender, Roblox
Studio) stay on the main PC, which reaches the host over Tailscale, as the phone does now.

## What the host must provide

| Need | Where it shows | Without it |
|---|---|---|
| A Windows user signed in to the Claude Code CLI. The server runs as that same user | `src/lib/claude.ts:20`; SETUP.md (an `ANTHROPIC_API_KEY` in the environment moves billing to that key) | CORE, agents, briefing polish and every model call fail |
| Node ≥ 22.6, git, PowerShell 5.1 | `package.json` engines; `scripts/launch.ps1`; build stamp from `git rev-parse` | No build, restart or deploy |
| Supervisor `scripts/launch.ps1` (build swap, restart with backoff, gives up after more than 5 exits in 10 min) | launch.ps1 l.68-183 | A crash stays down |
| Data folder `%LOCALAPPDATA%\orbit` (about 80 stores, VAULT, OAuth tokens, `stop-all.json`), plus `..\orbit-studio` and `..\orbit-backups` next to the checkout | `src/lib/data-dir.ts:5`, `clips/factory.ts:46`, `backup.ts:45` | State is lost or split if the user or folder changes |
| `SUPABASE_SECRET_KEY` | `scheduler.ts:112` | The scheduler, phone, push and backups are off |
| Tailscale Serve to `localhost:3000` (never Funnel) | docs/PHONE.md | No phone or remote access |
| Clock in Europe/Tallinn | Briefings use the host's local time (`scheduler.ts:118`); 41 lib files use `Europe/Tallinn` | On a UTC host, briefings fire 2 h off |
| ffmpeg (bundled), yt-dlp, a browser for page reading | `factory.ts:88-96`, `browser.ts:33-45` | Clips and scout downloads fail; page reading falls back to plain fetch |
| Optional: an NVIDIA GPU with about 6 GB VRAM | ComfyUI, local-AI 3D and voice clone only | Those tools only; everything else uses the CPU |

**One-time interactive steps on the host:**
- The Claude CLI login.
- Higgsfield's MCP sign-in, done inside the CLI.
- The YouTube and Google Calendar OAuth. These accept only `localhost:3000` as the redirect (`yt-analytics-pure.ts:106`; calendar OAuth refuses any `x-forwarded-host`), so they must be done in a browser on the host itself or through an SSH tunnel. The tokens then live in the data folder.

## Gaps for always-on operation, ranked

1. **Nothing outside ORBIT notices that ORBIT is down.**
   - Every monitor (heartbeat, system health, daily digest) runs inside the Next process.
   - The phone shows "host offline" only when it is opened.
   - After launch.ps1's "GAVE UP", nothing alerts.
   - JARVIS-PLAN §3 rejected an outside dead-man ping for the daily status. For an unattended host, "is it up at all" is a different question.
   - **Proposal:** a tiny watchdog outside ORBIT (a scheduled task) that checks `/login` and the heartbeat file every 5 min and sends one ntfy push with a label only. **Decision for Andreas.**
2. **Backups depend on the night shift.**
   - The Time Capsule runs only from the night shift (`night.ts:142`, `:253`) or "Back up now".
   - The night shift exists because the PC sleeps (`scripts/night`: 04:30 wake, then suspend).
   - On an always-on host, the capsule should run from the scheduler when `backupDue()`, regardless of whether the night shift is on.
   - A capsule folder on the same disk as the data is not a backup: the folder should be a second disk or a synced folder, and Doctor should warn about it.
3. **Boot without anyone signing in.**
   - Autostart is an AtLogOn, interactive task (`tools/autostart/enable.ps1:13-20`).
   - For a headless host: a task "at startup, run whether the user is signed in or not" as **the same user**, running `launch.ps1 -ServerOnly`.
   - Open question, to verify on a disposable Windows VM before relying on it: does the Claude CLI login load in that non-interactive session? The login is a file in the user's profile, so it should, but this is untested.
4. **Time zone:**
   - Briefings follow the host's clock while most of ORBIT uses Europe/Tallinn.
   - Either set the host to Tallinn (enough for a mini-PC), or make the scheduler use Europe/Tallinn explicitly (needed for a VPS).
5. **Release and verification:**
   - Deploying is still `git pull`, `npm ci`, `npm run app:rebuild` by hand (docs/RELEASE.md).
   - The Windows release smoke (`.github/workflows/windows-release-smoke.yml`, separate PR) proves an exact commit on a clean Windows VM and records the version it tested.
   - Doctor's running commit should then equal that recorded commit.
   - The self-dev supervisor (#417/#425/#428) would automate this, but it stays off until Andreas decides.
6. **Restoring the Supabase export:**
   - The weekly export has no importer (SETUP.md §9), so a lost Supabase project can't be restored from it.
   - The Time Capsule covers only the local data folder.

## Why not a Linux VPS

- **The supervisor, autostart, night and wake scripts** are all PowerShell or Task Scheduler. On Linux they would need a systemd unit, and the build swap and restart logic would have to be ported.
- **The GPU tools, the Roblox Studio MCP and Blender** need a desktop or a GPU. ComfyUI is a Windows portable build.
- **The OAuth flows** are loopback-only: one tunnel per connection.
- **Data on a rented server:** VAULT files, OAuth tokens and Journal/LIFE data would sit on someone else's machine. AGENTS.md rule 6 keeps Journal/LIFE text inside ORBIT, and a VPS changes where "inside" is. **Decision for Andreas.**
- **The server's IP** would make outbound requests that today come from his home connection (e.g. YouTube, scraping), and those providers may treat it differently.
- **What a VPS gets right:** real uptime, no sleep, and power and network that don't depend on his home. If wanted later, gap 4 (time zone) and the supervisor port are the prerequisites.

## Next tasks (Agent 3)

Each gets its own branch and draft PR:
1. Capsule from the scheduler on always-on hosts, plus a Doctor warning when the capsule folder is on the data disk (gap 2).
2. Test the headless boot task on a disposable Windows VM, with a stub CLI login file in the profile (gap 3).
3. A design-only proposal for the outside watchdog (gap 1), to wait for Andreas's decision.
