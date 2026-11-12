# ORBIT — Your mind has a universe

[![Checks](https://github.com/andreaskuus14/orbit/actions/workflows/ai-quality.yml/badge.svg)](https://github.com/andreaskuus14/orbit/actions/workflows/ai-quality.yml)

A personal AI "second brain" in a 3D galaxy: CORE chat with memory, news briefings, agents, voice, life tools, a file vault, a YouTube Shorts studio and game-dev tools.
CORE runs on **Claude Code under your own Claude login**, so there is no API key and no token bill.

**Out of the box** (after Setup below): login, galaxy, MEMORY, CORE, agents, automations, LIFE, VAULT + Workspaces, voice, Trend Radar's Roblox lists and Reach without Twitch. Everything else needs one of the items in [Needs configuration](#needs-configuration).

## What works in Phase 1
- **Login**: email magic link (Supabase Auth), optional email allowlist.
- **Galaxy**: Three.js / React Three Fiber. Click CORE or a planet to open its workspace. Drag to rotate, scroll to zoom (with inertia, idle drift and a small HUD). 2D view and reduced-motion mode included.
- **Living universe**: the galaxy reacts to rows in the `events` table via Supabase Realtime. A new memory pulses MEMORY and adds a moon; a running CORE request launches a satellite; a failed request puts a red warning ring on CORE. Nothing is decorative or simulated.
- **MEMORY**: capture notes, ideas, decisions and links (pages are fetched and stored as text, with SSRF protection). Keyword search, optional semantic search, tags, edit, delete, JSON export. Similar memories are *suggested*; nothing links until you confirm.
- **CORE**: searches your memory first, answers with numbered citations, shows an execution trace. Uses your profile (only what you typed).
- **ANALYTICS**: real counts and recent events from your own data, plus a Claude usage meter (rolling 5-hour and 7-day windows, by purpose, with your own budget).
- **Command bar** sends a request to CORE. **Warp** (Ctrl/⌘ K) jumps anywhere, searches everything and runs quick actions.

## Phase 2: INTELLIGENCE
- **Pulse** (news intelligence agent) fetches your feeds (topics become Google News search feeds; any RSS/Atom URL works), removes duplicates, groups headlines into events, counts independent outlets, and has Claude write a briefing that may only use those articles. Every claim cites real articles with links and timestamps; stories are marked *Confirmed* (2+ outlets) or *Single source*. Drafts without verifiable sources are discarded.
- Briefings: **Morning Orbit** 07:30, **Midday Pulse** 12:30, **Evening Debrief** 19:00, **Weekly Intelligence** Sunday 18:30 (this PC's local time), plus "Brief me now". Each briefing is also saved to MEMORY so CORE can recall it.
- Scheduled briefings run inside the ORBIT server (no browser needed) once `SUPABASE_SECRET_KEY` is in `.env.local`. If the PC was asleep, a missed briefing is caught up within 4 hours, never twice. Failures are logged and turn the INTELLIGENCE orbit red.
- The Pulse briefings themselves don't include calendar items; the morning card you see when you open ORBIT does, once Google Calendar is connected (see LIFE).

## Phase 3: AGENTS + OPERATIONS
- **The team**: Nova (executive, delegates), Atlas (research with sources), Pulse (news), Echo (memory), Forge (documents/code/plans), Vector (your real activity numbers), Sentinel (topic monitoring), Orbit QA (verifies other agents' claims). Create your own agents with custom instructions and an allow-list of tools.
- **How agents work**: each agent is Claude (via Claude Code) running a step loop. Every step is one JSON reply that either calls a real tool (memory search, Google News search, read a web page, run Pulse, ORBIT stats, delegate to another agent…) or gives the final answer. Max 7 steps per task, delegation 2 levels deep, 2 tasks at once.
- **Approvals**: anything an agent wants to change in your data (saving to MEMORY, creating a project, queuing follow-up tasks) is proposed, not done. The task shows "Needs your approval" with Approve / Reject.
- **Everything is persisted**: tasks with status, result, full execution trace, delegated sub-tasks, and per-agent token usage. Tasks interrupted by a restart are marked failed and can be retried.
- **Command bar**: switch the button to **Task** and type a request; Nova takes it, delegates, and the OPERATIONS panel shows live progress. **Ask** mode still chats with CORE.
- **Living galaxy**: one satellite per running agent task circles the AGENTS planet; finished work pulses CORE.
- **Proposals**: agents suggest work from your news, tasks and memories; nothing runs until you approve (`0006_orbit_proposals.sql`).
- **Goals** (AGENTS → 🎯 Goals): a goal with a metric and deadline; an agent drafts a plan of steps, and nothing runs until you approve it. Goals advance only when a step finishes, when you open ORBIT or the goal, or when you press Continue (no timers), within a runs-per-day and calls-per-step budget. Steps that publish, upload, schedule, send or delete always wait for your OK. Setup: `0010_goals.sql`.
- Setup: run `supabase/migrations/0003_orbit_phase3_agents.sql` in the Supabase SQL Editor.

## CORE + web access
- **CORE uses tools now**: ask anything in Ask mode and CORE answers from your memories, **reads links you paste**, **reads the latest news**, or **hands a job to an agent** (Atlas, Pulse, Forge, Vector…) and answers with its result. Agent jobs it starts show up in OPERATIONS like any task. It can also read LIFE, VAULT, your calendar and your local git history (below).
- **CORE saves memories**: when your latest message asks it to remember something, CORE saves it straight to MEMORY (no approval step), up to 20 CORE saves a day. It refuses when the request came from a web page, memory or tool output rather than you. After each chat it also reflects on *your* messages only: saves durable facts about you, updates its style playbook (`0007_orbit_playbook.sql`, editable in Profile) and summarises long chats.
- **What ORBIT believes** (MEMORY): small "subject → statement" beliefs taken from your own words each turn; a newer statement supersedes the old one, and you can edit or Forget them. Needs `0008_memory_facts.sql` (without it this is simply off).
- **Workspaces**: ask CORE to "build me a website" (or a script, a game) and it writes real files instead of pasting code, but only when your latest message asks for it. Files live on this PC in `<ORBIT data folder>\workspaces`, shown under **VAULT → Workspaces** (browse, read, open the preview, move to trash). The preview link is signed and offline (CDNs and external URLs are blocked). **Check before showing**: after writing a site ORBIT renders it headlessly at desktop and phone width (Chrome/Edge via `playwright-core`), collects errors, 404s, overflow, broken images and contrast problems, saves screenshots, and CORE fixes what it finds (up to 2 rounds) before giving you the link. No browser → static checks only.
- **Hidden browser**: when a page needs JavaScript (or a plain download gets nothing readable), ORBIT opens it in a hidden copy of your installed Chrome/Edge (via `playwright-core`; nothing extra downloaded). Fresh profile every time, never logged in, images/media skipped, and requests to your own PC or home network are blocked. Set `ORBIT_BROWSER_PATH` to use a specific browser executable. Briefings don't use it (speed); CORE and agents do.
- Still not readable: login-only pages and hard paywalls.

## Offline brain (optional)
When Claude is unreachable, rate-limited or the usage hold is on, CORE chat and background summaries can fall back to a local model on this PC; CORE marks those answers with a **local brain** badge, and the local model has no tools (plain answers only). Nothing that drafts an outgoing message ever uses it. To set it up on Windows run `powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1` (installs Ollama, pulls `qwen3:8b`, sets `ORBIT_LOCAL_LLM_MODEL`; add `-Private` to also let it, and only it, reflect on your LIFE journal when you click), then restart ORBIT; see [tools/ollama/README.md](tools/ollama/README.md). DEV world's Games tab shows whether Ollama is reachable and the model is pulled.

## Voice
- **Push-to-talk**: the mic button in the command bar (or Ctrl+M); Esc cancels. Questions are transcribed by Chrome (fast; audio goes to Google) or **Local Whisper** on this PC (`/api/voice/transcribe`; the model downloads on first use).
- **Hands-free** (say "Orbit, …" or "Hey Orbit"), in voice settings: **Chrome recognition** (the default; streams mic audio to Google while the tab is visible and was used in the last minute), **ORBIT mic** (local Whisper with one always-open, echo-cancelled mic; optional interrupt-by-voice for headphones) or **Local only** (Whisper on this PC, stops listening while ORBIT talks). English, or Estonian (downloads a further ~1 GB model).
- **Conversation mode** ("Orbit, let's talk" or 💬): keeps listening after each answer without the wake word, either until you say stop or for one follow-up. Ends after 5 minutes without a question (one follow-up: 30 s of silence). **Remember my voice** stores a rough local voice profile so open mic can ignore a TV or other people (not a security lock; audio stays in the browser).
- **Spoken answers**: ORBIT always opens **muted**; click 🔇 to hear answers (voice and speed are adjustable). "Orbit, shut down" says goodbye and closes the window.
- **Wake word with ORBIT closed** (Windows): `npm run wake:install` starts an offline listener (Windows speech recognition, nothing recorded) for "orbital wake up" that starts the server if needed and opens ORBIT listening. See [scripts/wake/README.md](scripts/wake/README.md).

## Automation Studio (OPERATIONS → Automations)
- Workflows that run on their own: **every hour / day / week** at a time you choose, or **when you save a memory** (optionally only documents, links, notes or ideas) or **when a new briefing is ready**. Each run is a normal agent task (trace, retry, approvals), linked from the automation.
- Templates: weekly project review (Nova), summarize new documents (Echo), morning world watch (Sentinel), daily YouTube ideas (Forge). Or say it in Task mode ("every Friday at 16:00 summarize my week") and **Flow**, the automation agent, proposes it for your approval.
- Runs inside the ORBIT server with `SUPABASE_SECRET_KEY` (same as scheduled briefings); missed slots catch up within 3 hours (30 min for hourly). Only memories *you* save trigger memory automations, so agents can't set off loops. A failed last run turns the OPERATIONS orbit red.
- **🛑 Stop-all** (top bar) pauses every background lane (scheduler, automations, agents, goals, scout, autopilot, Herald) and cancels running work; background lanes also pause on their own when Claude's usage limit is hit.
- Setup: run `supabase/migrations/0004_orbit_automations.sql`.

## GAME DEV (CREATION)
- Also on the planet: reference board, scene planner, textures, a Luau code helper (checked against the Roblox API docs), sounds, thumbnails, playtests and **Trend Radar** (public Roblox discovery lists; its YouTube Gaming chart needs Connect YouTube in STUDIO).
- **Roblox Studio bridge**: builds into your open Studio place through a sandboxed Claude Code run that may only use an allow-list of your Roblox Studio MCP server's tools. Needs `ORBIT_ROBLOX_MCP_COMMAND` (and `ORBIT_ROBLOX_MCP_ARGS` if any), copied from the `Roblox_Studio` entry in Claude desktop's `claude_desktop_config.json`, and Studio open with its MCP plugin on.
- Setup: run `supabase/migrations/0005_orbit_games.sql`.

## STUDIO (YouTube Shorts)
- **Channel view**: your videos as moons, comets when one takes off. Needs `YOUTUBE_API_KEY` (YouTube Data API v3) and `YOUTUBE_CHANNEL` (@handle, UC… id or channel URL) in `.env.local` (not in `.env.example` yet).
- **Clip Factory**: drop long videos into `<studio>/inbox` (`ORBIT_STUDIO_DIR`, default `orbit-studio` next to the ORBIT folder) or add one from a link; ORBIT transcribes it with local Whisper, picks moments, reframes to 9:16, burns captions and offers titles and thumbnails for review. Works out of the box: ffmpeg comes from `ffmpeg-static` (or set `ORBIT_FFMPEG`) and the Whisper model downloads by itself on the first job. **Add from link**, **📚 Study** (why a Short works → a playbook that tunes picking and editing) and the **Video Scout** need `yt-dlp` (`winget install yt-dlp.yt-dlp`, or `ORBIT_YTDLP`); the scout, learning loop and comments inbox also need `YOUTUBE_API_KEY`. Files dropped in `inbox/devlog` become "Day N" devlog Shorts.
- **Hyperframes effects** (optional): animated captions, hook card and pop-ups. The `hyperframes` package is a dev dependency (`npm install`), and it also needs `npx hyperframes browser ensure` once; when missing or failing, clips keep the plain burned captions with a warning.
- **Analytics, publishing and autopilot**: **Connect YouTube** uses a Google Cloud *Desktop app* OAuth client (`YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET`) with the YouTube Data API v3 and YouTube Analytics API enabled; it asks for analytics + read-only + `youtube.upload` scopes. Open ORBIT at http://localhost:3000 to connect. Then: real channel stats, uploads, scheduled publishing into your time slots ("Schedule all approved"), and **Autopilot** (scout → clip → package → slot proposals) that never publishes on its own: each clip waits for your approval. Comments are read-only; reply drafts are for you to paste.
- **Night run** (Windows, optional): `npm run night:install` wakes the PC daily, runs the scout and its clip jobs, then sleeps again. See [scripts/night/README.md](scripts/night/README.md).
- **🩺 Check Orbital** (Doctor) shows which of ffmpeg, yt-dlp, Whisper and Hyperframes are present and how to fix what's missing.

## LIFE, VAULT, search and notifications
- **LIFE** (planet): habits with streaks and a 7-day view, reminders (toast + desktop notification), a 25/5 or 50/10 focus timer, and a daily journal. Stored only on this PC in `<ORBIT data folder>\life.json` (`ORBIT_DATA_DIR`, default `%LOCALAPPDATA%\orbit`). CORE can read it ("how are my habits?") and, when you ask in your message, add a habit, mark one done or set a reminder ("remind me at 6 to call mom"). Stats show in ANALYTICS; today's habits and the next reminder show in the morning briefing. Included in exports (`local.life`).
- **Google Calendar** (LIFE → Today → Connect Google Calendar): **read-only** (`calendar.readonly`), today plus the next days in LIFE, the morning card and CORE ("what's on this week?"). Needs a Google Cloud *Desktop app* OAuth client with the Google Calendar API enabled: `GCAL_OAUTH_CLIENT_ID` / `_SECRET`, or it reuses the YouTube client (a separate client is recommended so disconnecting one never affects the other). Open ORBIT at http://localhost:3000 to connect; the token stays in the ORBIT data folder.
- **Git** (read-only, local): CORE can summarise "what did I change this week" from `git log` / `git diff --stat` on the repos in `ORBIT_GIT_REPOS` (semicolon-separated) or the STUDIO → Devlog field. There is no GitHub integration: nothing is fetched from or pushed to GitHub.
- **VAULT** (planet): a private file vault on this PC in `<ORBIT data folder>\vault` (40 MB per file, 5 GB / 2000 files). Upload or drop files, preview images/video/audio/text/PDF, search names or text inside (PDF, Word, text), rename, delete, ask CORE about a file, or save a copy to MEMORY (that copy goes to Supabase). Every file also gets a private cloud copy in your Supabase storage (`<user id>/vault-files/`, free plan 1 GB total, 50 MB per file): run `supabase/migrations/0009_vault_cloud.sql` once. ☁ marks files with a cloud copy; **Sync now** uploads missing ones and **Download to this PC** restores cloud-only files. CORE's **Workspaces** are listed here too.
- **Search everything**: Ctrl/⌘+P (or ⌕ in the top bar): planets, actions, memories, VAULT file names, or "Ask CORE".
- **Notifications** (🔔 in the top bar): history of STUDIO notes, reminders and agent tasks; click one to go there.
- **Herald**: animated pop-up cards (uploads, trends, briefings, breaking news), at most 3 on screen and 4 an hour; never speaks or takes focus. A server-side watch every 3 hours scans Reach and, once YouTube is connected in STUDIO, your niche and trends; and new clippable finds also get a **Windows toast**. "Clip it now" is always your click.
- **Reach** (GAME DEV → Trend Radar → Rising): anonymous, read-only "what's exploding" from Reddit, Kick and Bluesky, polite rate limits and no logins. Twitch clips are optional via your own free app key (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`, app token only).
- ORBIT is installable as an app (manifest + icons) and the layout works on phone-sized screens; it still only listens on 127.0.0.1. **Phone access:** see [docs/PHONE.md](docs/PHONE.md) (private HTTPS through Tailscale Serve, no ports opened). The light phone remote (`/remote`: approvals, Stop-all, Studio queue, ask CORE) pairs with a 2-minute code; setup is in the same doc.

## Needs configuration
| Feature | What to set |
|---|---|
| Agents, automations, proposals, goals, game saves, beliefs, VAULT cloud copies | Their migration (all are in Setup step 1) |
| Scheduled briefings, automations, weekly backup | `SUPABASE_SECRET_KEY` |
| Semantic search, link suggestions | `VOYAGE_API_KEY` |
| STUDIO channel view, Video Scout, learning loop, comments | `YOUTUBE_API_KEY` (+ `YOUTUBE_CHANNEL` for the channel view) |
| Add from link, Study, Scout downloads | `yt-dlp` on PATH (or `ORBIT_YTDLP`) |
| YouTube analytics, uploads, scheduled publishing, autopilot, Trend Radar's YouTube chart, Herald niche scan | `YOUTUBE_OAUTH_CLIENT_ID` / `_SECRET` (Desktop app client, Data + Analytics APIs) |
| Hyperframes Shorts effects | `npx hyperframes browser ensure` (package installs with `npm install`) |
| Google Calendar (read-only) | `GCAL_OAUTH_CLIENT_ID` / `_SECRET` (or the YouTube client), Calendar API enabled |
| Git summaries | `ORBIT_GIT_REPOS` or STUDIO → Devlog repos |
| Roblox Studio bridge | `ORBIT_ROBLOX_MCP_COMMAND` (+ `ORBIT_ROBLOX_MCP_ARGS`) |
| Reach: Twitch clips | `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` |
| Wake word with ORBIT closed; night run | `npm run wake:install`; `npm run night:install` (Windows) |

## Not built yet
Gmail, GitHub and Notion integrations; a knowledge-graph view; hardening and public deployment. Files uploaded to MEMORY are not described automatically (images are stored, and their text is extracted only from documents); images attached in a CORE chat are seen by CORE. MEMORY uploads (PDF, Word .docx, text, Markdown, CSV, images, max 4 MB) are stored privately in the `vault` bucket; their text is extracted for search.

## Setup
Full guide with every setting: [docs/SETUP.md](docs/SETUP.md). What each planet does: [docs/FEATURES.md](docs/FEATURES.md). Safety rules: [docs/SAFETY.md](docs/SAFETY.md). New since your last look: [docs/FEATURES.md → Since you were away](docs/FEATURES.md#since-you-were-away).

1. **Supabase** (free tier): create a project. In *SQL Editor* run every file in `supabase/migrations` in number order, `0001` to `0020` (list and notes: [docs/SETUP.md](docs/SETUP.md#1-supabase-migrations-in-order)). In *Authentication → Providers → Email* keep email on and, since this is personal, turn **off** "Allow new users to sign up" after you have signed in once (or rely on `ORBIT_ALLOWED_EMAILS`). In *Authentication → URL Configuration* add `http://localhost:3000/auth/callback` to the redirect URLs.
2. **Claude Code**: install it and run `claude` once to sign in with your Claude account.
3. **Configure**: `cp .env.example .env.local` and fill in the Supabase URL and anon key plus your email in `ORBIT_ALLOWED_EMAILS`. Add anything from [Needs configuration](#needs-configuration) you want.
4. **Run** (Node 22.6+), in PowerShell or a terminal inside the `orbit` folder: `npm install`, then `npm run dev`, and open http://localhost:3000.

## ORBIT as a desktop app (Windows)
Run `npm run app:install` once. It puts an **ORBIT** icon on your Desktop and in the Start menu. Double-click it: if the ORBIT server isn't running it starts a **production build** in the background (building first when the code changed; a hidden supervisor restarts it if it crashes; log: `orbit-server.log`), then opens ORBIT in its own window (Chrome or Edge app mode, no tabs). The server only listens on this PC (127.0.0.1), not your network. Closing the window leaves the server running so scheduled briefings still happen; `npm run app:stop` stops it. `npm run app:autostart` makes the server start whenever you sign in to Windows (`npm run app:autostart-off` undoes it). All commands (start, stop, rebuild, dev): [scripts/README.md](scripts/README.md). In Chrome you can also use ⋮ → Cast, save and share → Install ORBIT.

## Backups
- **Export JSON** (MEMORY panel) downloads everything: profile, memories, links, chats, tasks (with traces and pending approvals), proposals, playbook, automations, agents, projects, feeds, articles, briefings, game saves and logs, plus 1-hour download links for your uploaded files.
- **Weekly automatic backup** (needs `SUPABASE_SECRET_KEY`): the server writes the same export to `orbit-backups\orbit-YYYY-MM-DD.json` next to the ORBIT folder (set `ORBIT_BACKUP_DIR` to change it) and copies uploaded files into `orbit-backups\files`. The last 8 exports are kept.

## Important limits
- ORBIT must run on the computer where Claude Code is installed and signed in. It does **not** work on Vercel or any server without your Claude login, and CORE only works while that computer is on. Scheduled/background jobs (Phase 2+) would stop when it sleeps. Moving to an always-on server later means switching `src/lib/claude.ts` to the paid Claude API.
- This is meant for personal use. Check Anthropic's current terms before using a subscription login for anything beyond that.
- Semantic search and link suggestions run on a free local model by default. `VOYAGE_API_KEY` switches them to Voyage AI (a separate paid service that then receives memory text) unless `ORBIT_EMBED=local`. The `memories.embedding` column is 1024 dimensions to match `voyage-4`.
- Each Claude call (CORE and agents) is a fresh Claude Code process with its own tools and your connectors disabled; ORBIT runs the tools itself (memory, web pages, news, agents) and passes results back as data, never as instructions.

## Tests
- `npm test`: the unit tests in `tests/` (pure logic across ORBIT: search, citations, SSRF guard, voice, clips, goals, Reach…) plus a **real** call through your Claude Code CLI (skipped if it isn't installed).
- `npx tsc --noEmit -p .` (or `npm run typecheck`): type-check.
- `npm run smoke`: browser smoke test of the pages that work without signing in (`/demo` and its worlds, `/remote`, `/screen`, `/login`) at desktop and phone sizes. Needs ORBIT running (or `SMOKE_BASE=<url>`) and Playwright's Chromium; read-only, exits 1 on any finding.
- `npm test` also guards Estonian coverage (`tests/i18n-coverage.test.ts`: hard-coded English per component may only go down) and basic accessibility (`tests/a11y-static.test.ts`).
- CI: `.github/workflows/ai-quality.yml` runs on every pull request and push to `main`: install, `tsc --noEmit -p .`, `npm test`, `npm run eval:ai` and `next build` (no secrets, read-only token).
- To check a production build, use `npm run app:rebuild`, not `npm run build` while ORBIT runs (it overwrites the running server's build).

## Layout
`src/lib/claude.ts` Claude Code bridge · `core.ts` CORE turn · `memory.ts` capture/search · `src/lib/clips` STUDIO · `src/components/Galaxy.tsx` 3D scene · `panels.tsx` workspaces · `src/components/voice` voice · `supabase/migrations` schema with row-level security on every table.

