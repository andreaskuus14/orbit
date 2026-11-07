# Setting up ORBIT

Everything here is done once, on the Windows PC that runs ORBIT, in **PowerShell** inside the `orbit` folder.
Settings live in `.env.local` (never in git). `.env.example` lists every name with an empty value: copy it once with

```
Copy-Item .env.example .env.local
```

then fill in what you need. After changing `.env.local`, restart ORBIT (`npm run app:stop`, then double-click the ORBIT icon, or `npm run app:start`).
🩺 **Check ORBIT** (Ctrl+P → *Check ORBIT health*) shows what's set up and what's missing.

Features: [FEATURES.md](FEATURES.md) · Safety: [SAFETY.md](SAFETY.md) · Phone: [PHONE.md](PHONE.md) · Start/stop commands: [scripts/README.md](../scripts/README.md)

---

## 1. Supabase migrations (in order)

Supabase → your project → **SQL Editor**. Open each file from `supabase/migrations`, paste it, press **Run**. Run each one **once**, in this order. If you already ran some earlier, start from the first one you haven't run.

| # | File | What it adds |
|---|------|--------------|
| 1 | `0001_orbit_phase1.sql` | Profile, memories, chats, events (the base) |
| 2 | `0002_orbit_phase2_news.sql` | News feeds and briefings |
| 3 | `0003_orbit_phase3_agents.sql` | Agents and tasks |
| 4 | `0004_orbit_automations.sql` | Automations |
| 5 | `0005_orbit_games.sql` | GAME DEV saves |
| 6 | `0006_orbit_proposals.sql` | Agent proposals |
| 7 | `0007_orbit_playbook.sql` | CORE's style playbook |
| 8 | `0008_memory_facts.sql` | "What ORBIT believes" |
| 9 | `0009_vault_cloud.sql` | VAULT cloud copies |
| 10 | `0010_goals.sql` | Goals |
| 11 | `0011_business.sql` | BUSINESS prospects |
| 12 | `0012_fact_history.sql` | Belief history (needs 0008) |
| 13 | `0013_core_context.sql` | CORE keeps attached-file text per chat |
| 14 | `0014_usage_totals.sql` | ANALYTICS usage totals |
| 15 | `0015_prospect_template.sql` | BUSINESS reply rate per angle |
| 16 | `0016_ledger.sql` | Event ledger links |
| 17 | `0017_journal.sql` | "Today in a minute" journal entries |
| 18 | `0018_episodes.sql` | Episodic memory |
| 19 | `0019_memory_provenance.sql` | Where each memory came from, confirmed or suggested |
| 20 | `0020_missions.sql` | Missions |

Without 0017, evening notes refuse to save (your text stays in the box). Without 0018, episodes can't be saved. 0014–0020 are safe to run again; the others stop with an "already exists" error the second time.

Also in Supabase: **Authentication → URL Configuration** → add `http://localhost:3000/auth/callback` (and your Tailscale address, see [PHONE.md](PHONE.md)).

## 2. Settings (`.env.local`)

**Required** = ORBIT won't work without it. Everything else is optional; empty means the default or "feature off".

### Basics

| Name | What it's for | Needed? |
|------|---------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project address (Project Settings → API) | **Required** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key | **Required** |
| `ORBIT_ALLOWED_EMAILS` | Emails allowed to sign in (comma-separated). Empty = any account in your Supabase project | Strongly recommended |
| `SUPABASE_SECRET_KEY` | Supabase secret key. Lets briefings, night shift, backups, phone remote and push work with no browser open. Never put it in a `NEXT_PUBLIC_` name | Recommended (needed for the phone) |
| `ORBIT_DATA_DIR` | Folder for ORBIT's local files. Empty = `%LOCALAPPDATA%\orbit` | Optional |
| `ORBIT_BACKUP_DIR` | Weekly backup folder. Empty = `orbit-backups` next to the ORBIT folder | Optional |

### Claude (CORE)

CORE uses your own Claude Code login, no API key. Install Claude Code and run `claude` once to sign in.

| Name | What it's for | Default |
|------|---------------|---------|
| `ORBIT_MODEL` | CORE's main model | sonnet |
| `ORBIT_MODEL_DEEP` | Model for hard questions | opus |
| `ORBIT_DEEP_EFFORT` | Effort for hard questions (low … max) | high |
| `ORBIT_MODEL_SMART` | Model for ORBIT's judgement calls (clip ranking, niche research) | opus |
| `ORBIT_MODEL_FAST` | Model for quick replies, notes, the brief polish | haiku |
| `ORBIT_CLAUDE_BIN` | Path to `claude` if it's not on PATH | claude |
| `ORBIT_CLAUDE_CONCURRENCY` | How many Claude calls may run at once | 3 |
| `ORBIT_CORE_MAX_STEPS` | Model steps CORE may take per answer (2–12) | 8 |
| `ORBIT_CORE_SESSION` | `resume` = one Claude session per CORE chat (faster follow-ups). Empty = each step starts fresh | off |
| `ORBIT_CLAUDE_WEEKLY_CALLS` | Your own weekly Claude budget in calls; the doctor's SYSTEM card shows 7-day use against it | off |
| `ORBIT_LOCAL_LLM_MODEL` | Ollama model (e.g. `qwen3:8b`; old name `ORBIT_LOCAL_MODEL`) for chat and summaries when Claude is unreachable. No tools in that mode. `ORBIT_LOCAL_LLM_URL` (this PC only), `ORBIT_LOCAL_PRIVATE=1` (journal Reflect, local only): tools/ollama/README.md | off |

If `ANTHROPIC_API_KEY` is set in your Windows environment, Claude Code bills that API key instead of your Claude login (DEV world → CORE config shows which).

### Memory search

| Name | What it's for | Default |
|------|---------------|---------|
| `ORBIT_EMBED` | `local` (free model on this PC) or `voyage` | Voyage if a key is set, else local |
| `VOYAGE_API_KEY` | Voyage AI key. **With a key set, memory text is sent to Voyage** unless `ORBIT_EMBED=local` | empty |
| `VOYAGE_MODEL`, `VOYAGE_API_URL` | Voyage model and address | voyage-4, MongoDB endpoint |

### STUDIO, YouTube, clips

| Name | What it's for | Default |
|------|---------------|---------|
| `YOUTUBE_API_KEY` | Read-only YouTube data (stats, Video Scout, comments) | off |
| `YOUTUBE_CHANNEL` | Your channel (@handle, UC… id or URL) | none |
| `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` | Google "Desktop app" client for analytics and uploads | off |
| `ORBIT_YT_DAILY_UNITS` | YouTube API units ORBIT may use a day (200–9000) | 4000 |
| `ORBIT_STUDIO_DIR` | Clip Factory folder (inbox, clips, jobs, music) | `orbit-studio` next to ORBIT |
| `ORBIT_FFMPEG` | Path to your own ffmpeg.exe | bundled |
| `ORBIT_YTDLP` | Path to yt-dlp.exe | yt-dlp on PATH |
| `ORBIT_WHISPER_MODEL` | Caption model for clips | whisper-base_timestamped |
| `ORBIT_WHISPER_MODEL_EN` | English-only caption model (must give word timings) | same as above |
| `ORBIT_WHISPER_DTYPE` | e.g. `q8`: faster, a bit less accurate | library default |
| `ORBIT_ASR_WORKERS`, `ORBIT_ASR_PARALLEL` | Transcription processes / pieces at once (more = more RAM) | 1 / same |
| `ORBIT_GIT_REPOS` | Your git folders, `;`-separated, for "what did I change" and devlogs (read-only) | none |

### Higgsfield (AI Story)

No key in `.env.local`: Higgsfield runs through your own Claude Code connector (see step 6).

| Name | What it's for | Default |
|------|---------------|---------|
| `ORBIT_HIGGSFIELD_WEEKLY_CAP` | Max credits you can approve per week (weeks start Monday 00:00 Tallinn). `0` = no spending at all | 10 |
| `ORBIT_HIGGSFIELD_IMAGE_MODEL`, `_VIDEO_MODEL`, `_AUDIO_MODEL` | Model ids | gpt_image_2_5 / seedance_2_5 / seed_audio |
| `ORBIT_TWIN_SPEND_MIN` | Spends of at least this many credits get the twin's "case against" first | half the weekly cap |
| `ORBIT_HIGGSFIELD_DRY_RUN` | `1` = fake Higgsfield (placeholder pictures, no credits, no network) | off |

### BUSINESS email (Resend)

| Name | What it's for | Default |
|------|---------------|---------|
| `RESEND_API_KEY` | Resend key for *Approve & send* | off (button hidden) |
| `ORBIT_MAIL_FROM` | Sender address, on a domain verified in Resend | off |
| `ORBIT_MAIL_REPLY_TO` | Where replies go | none |

### Phone, push, calls

| Name | What it's for | Default |
|------|---------------|---------|
| `REMOTE_SECRET` | 32+ random characters. Turns on `/remote`, pairing and Shortcuts. Changing it unpairs every phone and revokes every Shortcut token | off |
| `REMOTE_VAPID_PUBLIC`, `REMOTE_VAPID_PRIVATE` | Push notification keys (`npm run remote:vapid`) | off |
| `REMOTE_VAPID_SUBJECT` | Contact shown to Apple/Google (`mailto:` or `https:`) | mailto: first allowed email |
| `ORBIT_CALL_VOICE` | Kokoro voice for calls (Profile → ORBIT's character overrides it) | af_heart |

### Voice, browser, other

| Name | What it's for | Default |
|------|---------------|---------|
| `ORBIT_VOICE_WHISPER_MODEL` | Voice input model (English) | Xenova/whisper-small.en |
| `ORBIT_VOICE_WHISPER_MULTI_MODEL` | Voice input model (other languages) | Xenova/whisper-small |
| `ORBIT_BROWSER_PATH` | chrome.exe/msedge.exe for reading web pages | installed Chrome, then Edge |
| `ORBIT_ROBLOX_MCP_COMMAND`, `ORBIT_ROBLOX_MCP_ARGS` | Roblox Studio connection for GAME DEV: copy `command` and `args` of `Roblox_Studio` from `%APPDATA%\Claude\claude_desktop_config.json` | off |
| `GCAL_OAUTH_CLIENT_ID`, `GCAL_OAUTH_CLIENT_SECRET` | Own Google client for LIFE → Connect Google Calendar (read-only). Empty = uses the YouTube client | YouTube client |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Twitch clips in Reach | off |
| `ORBIT_REA_ENABLED`, `ORBIT_REA_TARGETS_JSON`, `ORBIT_REA_ENTRYPOINT` | REA project analysis, see [REA.md](REA.md) | off |

Don't set these yourself: `ORBIT_DIST_DIR` (the launcher sets it while building) and `ORBIT_REAL_CLAUDE_BIN` (only for a speed-test script).

The separate Lead Follow-up service has its own settings: `services/lead-followup/.env.example`.

## 3. Phone access (Tailscale Serve) and pairing

Follow [PHONE.md](PHONE.md): install Tailscale on PC and iPhone, then

```
tailscale serve --bg --https=443 localhost:3000
```

Use **serve**, never **funnel**. Then set `REMOTE_SECRET` (make one with the command below), restart ORBIT, and pair in Profile → **Pair phone**.

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. Push notifications (VAPID keys)

```
npm run remote:vapid
```

It prints two lines. Paste both into `.env.local`, keep the private one secret, restart ORBIT, then tap **Enable notifications** in the Remote app on the iPhone ([PHONE.md](PHONE.md#notifications-on-the-phone-ios-164)). Making a new pair turns notifications off until you enable them again. Push is also required before you can switch any area to Auto.

## 5. Siri / Watch Shortcuts tokens

Profile → Phone remote → **Shortcuts & Watch** → pick the action → **New token** → **Copy**. One token per Shortcut; it is shown only once. Recipes: [PHONE.md](PHONE.md#shortcuts--watch-orbit-from-siri-the-apple-watch-and-the-action-button).

## 6. Higgsfield (AI Story) and the weekly cap

1. Connect Higgsfield to your own Claude Code, once:
   ```
   claude mcp add -s user --transport http higgsfield https://mcp.higgsfield.ai/mcp
   ```
   Then run `claude`, type `/mcp`, and sign in to Higgsfield.
2. Set your weekly limit in `.env.local`, for example `ORBIT_HIGGSFIELD_WEEKLY_CAP=200`. Empty = 10 credits; `0` = nothing can be spent. Any Approve that would go over it is refused. The HUD shows "used / cap" for this week.
3. To try it without spending: `ORBIT_HIGGSFIELD_DRY_RUN=1`.

## 7. Resend email (BUSINESS *Approve & send*)

1. Sign up at resend.com, add and verify your domain (Resend shows the DNS records).
2. Create an API key. In `.env.local`: `RESEND_API_KEY=…`, `ORBIT_MAIL_FROM=you@yourdomain.com`, optionally `ORBIT_MAIL_REPLY_TO=…`.
3. Restart ORBIT. The *Approve & send* button appears on BUSINESS drafts. The same setup sends approved negotiation replies and signed contracts.

Without these, nothing is ever emailed: you copy drafts and send them yourself.

## 8. Optional Windows extras

- `npm run app:install`: ORBIT icon on the Desktop and Start menu. `npm run app:autostart`: start the server when you sign in.
- `npm run night:install`: a Scheduled Task that wakes the PC at 04:30 (change with `npm run night:install -- -At 03:00`) so night work can run. `npm run night:uninstall` removes it.
- Offline brain: `powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1`, then restart ORBIT.
- Start with Windows: `powershell -ExecutionPolicy Bypass -File tools\autostart\enable.ps1` (off: `disable.ps1`).
- `npm run wake:install`: an offline listener at sign-in; say "orbital wake up" and ORBIT opens with CORE greeting you. `npm run wake:uninstall` removes it.

## 9. Time capsule (backups)

Profile → **Time capsule**: pick a folder (an external drive or a OneDrive folder), choose a passphrase, done. Every night ORBIT writes an encrypted copy of its local folder there (14 nightly + 8 weekly kept); *Back up now* does it at once. **Write the passphrase down**: without it the backups can't be opened. To restore, use the restore wizard in the same place; it makes a safety backup first. This is separate from the weekly Supabase export (`ORBIT_BACKUP_DIR`), which is **export only**: ORBIT has no importer for it.
