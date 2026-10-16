# ORBIT — Your mind has a universe

Phase 1 (login, 3D galaxy with a 2D view, CORE chat, searchable memory with file uploads) and Phase 2 (live news, the Pulse agent, scheduled briefings).
CORE runs on **Claude Code under your own Claude login**, so there is no API key and no token bill.

## What works in Phase 1
- **Login**: email magic link (Supabase Auth), optional email allowlist.
- **Galaxy**: Three.js / React Three Fiber. Click CORE or a planet to open its workspace. Drag to rotate, scroll to zoom. 2D view and reduced-motion mode included.
- **Living universe**: the galaxy reacts to rows in the `events` table via Supabase Realtime. A new memory pulses MEMORY and adds a moon; a running CORE request launches a satellite; a failed request puts a red warning ring on CORE. Nothing is decorative or simulated.
- **MEMORY**: capture notes, ideas, decisions and links (pages are fetched and stored as text, with SSRF protection). Keyword search, optional semantic search, tags, edit, delete, JSON export. Similar memories are *suggested*; nothing links until you confirm.
- **CORE**: searches your memory first, answers with numbered citations, shows an execution trace. Uses your profile (only what you typed).
- **ANALYTICS**: real counts and recent events from your own data.
- **Command bar** (Ctrl/⌘ K) sends a request to CORE.

## Phase 2: INTELLIGENCE
- **Pulse** (news intelligence agent) fetches your feeds (topics become Google News search feeds; any RSS/Atom URL works), removes duplicates, groups headlines into events, counts independent outlets, and has Claude write a briefing that may only use those articles. Every claim cites real articles with links and timestamps; stories are marked *Confirmed* (2+ outlets) or *Single source*. Drafts without verifiable sources are discarded.
- Briefings: **Morning Orbit** 07:30, **Midday Pulse** 12:30, **Evening Debrief** 19:00, **Weekly Intelligence** Sunday 18:30 (this PC's local time), plus "Brief me now". Each briefing is also saved to MEMORY so CORE can recall it.
- Scheduled briefings run inside the ORBIT server (no browser needed) once `SUPABASE_SECRET_KEY` is in `.env.local`. If the PC was asleep, a missed briefing is caught up within 4 hours, never twice. Failures are logged and turn the INTELLIGENCE orbit red.
- Not yet: calendar items in Morning Orbit (needs the Phase 3 Google Calendar connection).

## Phase 3: AGENTS + OPERATIONS
- **The team**: Nova (executive, delegates), Atlas (research with sources), Pulse (news), Echo (memory), Forge (documents/code/plans), Vector (your real activity numbers), Sentinel (topic monitoring), Orbit QA (verifies other agents' claims). Create your own agents with custom instructions and an allow-list of tools.
- **How agents work**: each agent is Claude (via Claude Code) running a step loop. Every step is one JSON reply that either calls a real tool (memory search, Google News search, read a web page, run Pulse, ORBIT stats, delegate to another agent…) or gives the final answer. Max 7 steps per task, delegation 2 levels deep, 2 tasks at once.
- **Approvals**: anything that changes your data (saving to MEMORY, creating a project, queuing follow-up tasks) is proposed, not done. The task shows "Needs your approval" with Approve / Reject.
- **Everything is persisted**: tasks with status, result, full execution trace, delegated sub-tasks, and per-agent token usage. Tasks interrupted by a restart are marked failed and can be retried.
- **Command bar**: switch the button to **Task** and type a request; Nova takes it, delegates, and the OPERATIONS panel shows live progress. **Ask** mode still chats with CORE.
- **Living galaxy**: one satellite per running agent task circles the AGENTS planet; finished work pulses CORE.
- Setup: run `supabase/migrations/0003_orbit_phase3_agents.sql` in the Supabase SQL Editor.

## CORE + web access
- **CORE uses tools now**: ask anything in Ask mode and CORE answers from your memories, **reads links you paste**, **reads the latest news**, or **hands a job to an agent** (Atlas, Pulse, Forge, Vector…) and answers with its result. Agent jobs it starts show up in OPERATIONS like any task.
- **Hidden browser**: when a page needs JavaScript (or a plain download gets nothing readable), ORBIT opens it in a hidden copy of your installed Chrome/Edge (via `playwright-core`; nothing extra downloaded). Fresh profile every time, never logged in, images/media skipped, and requests to your own PC or home network are blocked. Set `ORBIT_BROWSER_PATH` to use a specific browser executable. Briefings don't use it (speed); CORE and agents do.
- Still not readable: login-only pages and hard paywalls.

## Automation Studio (OPERATIONS → Automations)
- Workflows that run on their own: **every hour / day / week** at a time you choose, or **when you save a memory** (optionally only documents, links, notes or ideas) or **when a new briefing is ready**. Each run is a normal agent task (trace, retry, approvals), linked from the automation.
- Templates: weekly project review (Nova), summarize new documents (Echo), morning world watch (Sentinel), daily YouTube ideas (Forge). Or say it in Task mode ("every Friday at 16:00 summarize my week") and **Flow**, the automation agent, proposes it for your approval.
- Runs inside the ORBIT server with `SUPABASE_SECRET_KEY` (same as scheduled briefings); missed slots catch up within 3 hours (30 min for hourly). Only memories *you* save trigger memory automations, so agents can't set off loops. A failed last run turns the OPERATIONS orbit red.
- Setup: run `supabase/migrations/0004_orbit_automations.sql`.

## Game Lab (CREATION)
- **Planet Forge**: a 10–15 minute space-mining game. Mining scars planets and can make them unstable; Industry adds factories, output and pollution; Restoration grows forests, renewable energy and stability. Upgrade the ship (laser, cargo, stabilizer drill) and build the jump gate. Keyboard, mouse or touch; sound with mute; respects reduced motion.
- Code: rules and state transitions in `src/games/planet-forge/rules.ts` (pure, tested in `tests/planet-forge.test.ts`), canvas renderer `render.ts`, UI `PlanetForge.tsx`. Games are registered in `src/games/registry.ts`; add a game there plus its component in `src/components/GameLab.tsx`.
- Saves and settings (mining yield, upgrade cost, planet damage, production) are stored per user in `game_saves` (RLS), validated by `/api/games/[game]` before writing. Saves are versioned; damaged saves start a fresh game with an explanation, and changed settings are listed when you load. No AI is needed to play, and ORBIT never runs generated code: agents may only change validated settings.
- Setup: run `supabase/migrations/0005_orbit_games.sql`.

## LIFE, VAULT, search and notifications
- **LIFE** (planet): habits with streaks and a 7-day view, reminders (toast + desktop notification), a 25/5 or 50/10 focus timer, and a daily journal. Stored only on this PC in `<ORBIT data folder>\life.json` (`ORBIT_DATA_DIR`, default `%LOCALAPPDATA%\orbit`). CORE can read it ("how are my habits?") and, when you ask in your message, add a habit, mark one done or set a reminder ("remind me at 6 to call mom"). Stats show in ANALYTICS; today's habits and the next reminder show in the morning briefing. Included in exports (`local.life`).
- **VAULT** (planet): a private file vault on this PC in `<ORBIT data folder>\vault` (40 MB per file, 5 GB / 2000 files). Upload or drop files, preview images/video/audio/text/PDF, search names or text inside (PDF, Word, text), rename, delete, ask CORE about a file, or save a copy to MEMORY (that copy goes to Supabase). VAULT files are **not** in exports or the weekly backup: keep copies of anything important.
- **Search everything**: Ctrl/⌘+P (or ⌕ in the top bar): planets, actions, memories, VAULT file names, or "Ask CORE".
- **Notifications** (🔔 in the top bar): history of STUDIO notes, reminders and agent tasks; click one to go there.
- ORBIT is installable as an app (manifest + icons) and the layout works on phone-sized screens; it still only listens on 127.0.0.1. **Phone access:** see [docs/PHONE.md](docs/PHONE.md) (private HTTPS through Tailscale Serve, no ports opened).

## Not built yet (shown honestly as "Phase N" in the UI)
Integrations (Gmail, Calendar, GitHub, Notion) (rest of Phase 3), creation studio for documents and code, voice, knowledge-graph view (Phase 4), hardening and public deployment (Phase 5). Also: CORE cannot save memories itself (use the capture box), and uploaded images are stored but not described automatically. Uploads (PDF, Word .docx, text, Markdown, CSV, images, max 4 MB) are stored privately in the `vault` bucket; their text is extracted for search.

## Setup
1. **Supabase** (free tier): create a project. In *SQL Editor* run `supabase/migrations/0001_orbit_phase1.sql`, then `0002_orbit_phase2_news.sql`, `0003_orbit_phase3_agents.sql`, `0004_orbit_automations.sql`, `0005_orbit_games.sql`, `0006_orbit_proposals.sql` and `0007_orbit_playbook.sql` (in that order). In *Authentication → Providers → Email* keep email on and, since this is personal, turn **off** "Allow new users to sign up" after you have signed in once (or rely on `ORBIT_ALLOWED_EMAILS`). In *Authentication → URL Configuration* add `http://localhost:3000/auth/callback` to the redirect URLs.
2. **Claude Code**: install it and run `claude` once to sign in with your Claude account.
3. **Configure**: `cp .env.example .env.local` and fill in the Supabase URL and anon key plus your email in `ORBIT_ALLOWED_EMAILS`.
4. **Run** (Node 22+), in PowerShell or a terminal inside the `orbit` folder: `npm install`, then `npm run dev`, and open http://localhost:3000.

## ORBIT as a desktop app (Windows)
Run `npm run app:install` once. It puts an **ORBIT** icon on your Desktop and in the Start menu. Double-click it: if the ORBIT server isn't running it starts a **production build** in the background (building first when the code changed; a hidden supervisor restarts it if it crashes; log: `orbit-server.log`), then opens ORBIT in its own window (Chrome or Edge app mode, no tabs). The server only listens on this PC (127.0.0.1), not your network. Closing the window leaves the server running so scheduled briefings still happen; `npm run app:stop` stops it. `npm run app:autostart` makes the server start whenever you sign in to Windows (`npm run app:autostart-off` undoes it). All commands (start, stop, rebuild, dev): [scripts/README.md](scripts/README.md). In Chrome you can also use ⋮ → Cast, save and share → Install ORBIT.

## Backups
- **Export JSON** (MEMORY panel) downloads everything: profile, memories, links, chats, tasks (with traces and pending approvals), proposals, playbook, automations, agents, projects, feeds, articles, briefings, game saves and logs, plus 1-hour download links for your uploaded files.
- **Weekly automatic backup** (needs `SUPABASE_SECRET_KEY`): the server writes the same export to `orbit-backups\orbit-YYYY-MM-DD.json` next to the ORBIT folder (set `ORBIT_BACKUP_DIR` to change it) and copies uploaded files into `orbit-backups\files`. The last 8 exports are kept.

## Important limits
- ORBIT must run on the computer where Claude Code is installed and signed in. It does **not** work on Vercel or any server without your Claude login, and CORE only works while that computer is on. Scheduled/background jobs (Phase 2+) would stop when it sleeps. Moving to an always-on server later means switching `src/lib/claude.ts` to the paid Claude API.
- This is meant for personal use. Check Anthropic's current terms before using a subscription login for anything beyond that.
- Semantic search and link suggestions need `VOYAGE_API_KEY` (Voyage AI is Anthropic's recommended embeddings provider and is a separate paid service). Without it, search is keyword-only. The `memories.embedding` column is 1024 dimensions to match `voyage-4`.
- Each Claude call (CORE and agents) is a fresh Claude Code process with its own tools and your connectors disabled; ORBIT runs the tools itself (memory, web pages, news, agents) and passes results back as data, never as instructions.

## Tests
`npm test` runs unit tests (search fusion, citations, SSRF guard, HTML extraction, validation) and a **real** call through your Claude Code CLI (skipped if it isn't installed).
**Not verified in the build environment:** `npm install`, `next build`, type-checking and the UI (its network blocked npm). Run `npm run typecheck && npm run app:rebuild` first (not `npm run build` while ORBIT runs: it overwrites the running server's build) and send me any errors.

## Layout
`src/lib/claude.ts` Claude Code bridge · `core.ts` CORE turn · `memory.ts` capture/search · `src/components/Galaxy.tsx` 3D scene · `panels.tsx` workspaces · `supabase/migrations` schema with row-level security on every table.
