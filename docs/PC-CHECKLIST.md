# PC checklist

Follow this the next time you sit at the Windows PC. It brings ORBIT up to date and checks that Wave 1 works. Work top to bottom. Open PowerShell in the `orbit` folder.

## 1. Update

```powershell
git checkout main
git pull
npm ci
npm run app:stop
# if something still holds port 3000, stop it:
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
npm run dev
```

Open http://127.0.0.1:3000. (Dev mode is slower than the installed build. For the perf test in step 4, use `npm run app:rebuild` instead.)

**Database migrations.** Open Doctor → **Database migrations**. It lists every file still missing. Apply each one in the Supabase SQL editor (supabase.com → your project → SQL Editor → New query → paste the whole file → Run), oldest first. Running a file twice is harmless.

| File | Needed for |
|---|---|
| `supabase/migrations/0021_task_claim.sql` | Agent tasks start (required) |
| `supabase/migrations/0022_proposal_basis.sql` | Approving suggestions (required) |
| `supabase/migrations/0023_attempt_ids.sql` | Approvals that create projects, tasks, automations (required) |
| `supabase/migrations/0025_task_origin.sql` | Scorecard replays carry an origin (optional) |
| `supabase/migrations/0026_prospect_drafted_at.sql` | Prospect `drafted_at`; without it Auto never sends a draft (optional) |

Doctor may also list other files (for example `0024_fact_entities.sql`). Apply whatever it lists. When Doctor shows none missing, this step is done.

## 2. Privacy steps for #560 (before 14 Nov)

Entries typed in the LIFE panel before the new code ran were stored as ordinary typed text. Typed commitments from before 14 Nov stay private permanently. The risk is an old tab that was never reloaded: after 14 Nov it would still save plain typed entries that ORBIT then treats as safe. So reload every open LIFE tab before 14 Nov:

1. Reload every open ORBIT tab that shows LIFE (Ctrl+Shift+R). An old tab still runs the old code.
2. Let one loops scan run (wait for the next scheduled one, or open the morning brief). Then check Needs you and the morning brief: no LIFE or journal text appears in any loop title.

## 3. Smoke test (about 10 minutes)

| Feature | Click path | You should see |
|---|---|---|
| Emblems and nebula | Home (2D view), then Explore | A round medallion emblem on each world card and panel header. A slow, seamless nebula loop behind the home cards. |
| Wake word (#566) | Mic on, say "Orbit, what time is it" | It wakes and answers. Say "Orbit of the moon is..." in normal speech: it must not wake. |
| Sun dome | ARCH → Sun path | Dome with three arcs (summer orange, equinox yellow, winter blue), hour lines, and the sun at the study time. |
| Study cards | ARCH → Study → make cards from a book chapter | Cards each with a Source. A weekly quiz is offered. |
| Weekly results | BUSINESS → This week | Views, leads, replies, revenue, each with its source, or "not connected". Never a made-up 0. |
| Bank reconcile | BUSINESS → Money → Reconcile → pick a bank CSV | Rows matched to invoices. Nothing is marked paid until you click **Mark paid**. |
| Tracked links | BUSINESS → Contracts → Share as a tracked link → Make link → Copy, open it on your phone | The page loads. The view appears in the list with the time. Revoke, then the link stops working. Nothing is sent. |
| Decisions | Tell CORE: "I decided to ..., because ..., revisit on ..." | CORE shows what/why/revisit first and saves only after you say yes. When the revisit day comes, a card appears in Needs you. |
| Timetable .ics | LIFE → Calendar card → Import, pick an `.ics` file; then Plan my day | Lessons show in the calendar and as fixed blocks in Plan my day. No Google sign-in needed. |
| Model log | ANALYTICS → MODEL LOG (last 7 days) | Count per model. A flag if any risky job ran below Opus. After a few CORE turns, the list is not empty. |
| vidIQ sign-in | Profile → Plugins → vidIQ → **Sign in** (from http://127.0.0.1:3000) | Browser sign-in, then back in Plugins with the row marked signed in. |

## 4. Wave 1 proofs

1. **Planet look (#521).** Stop dev, run `npm run app:rebuild`, then `npm run perf:run`. Hands off the PC for about 3 minutes (two window sizes). Compare to the previous run: exit code 2 means p95 over 15% slower. Also look at the planets next to the 12 approved style frames.
2. **5 clean mornings.** Five days in a row, ORBIT is running and the phone digest matches what STUDIO and Agents show (done or needs-you). Note each day: date, ok or what was wrong.
3. **Restore drill.** Profile → Time capsule → passphrase → **Run restore drill**. Then Doctor → Last recovery drill must show passed. Repeat about monthly.

## 4b. Maps lead list (B8)

ORBIT never scrapes. You run [gosom/google-maps-scraper](https://github.com/gosom/google-maps-scraper) yourself, then import its CSV.

1. Put one search per line in `queries.txt` (e.g. `juuksur Tartu`).
2. Run: `docker run -v %cd%:/data gosom/google-maps-scraper -input /data/queries.txt -results /data/results.csv -depth 1 -exit-on-inactivity 3m` (no `-email`).
3. BUSINESS → Lead loop → paste the CSV → **Import Maps CSV as drafts**. Up to 500 rows; duplicates of existing prospects are skipped.

Only name, category, address, city, phone, website and Maps link are kept; reviews, reviewer names and emails are dropped. Rows are drafts (source `maps-import`): Auto never sends them, only your own Approve & send does. FIE rows carry the consent warning.

Rules: the Google Maps Terms of Service prohibit scraping. Running gosom is your own decision and your own risk; ORBIT only reads the file you give it. B2B only, never consumer emails. GDPR legitimate interest: ORBIT adds the opt-out line and a [postal address] placeholder to every draft for these leads, and won't send one without the opt-out line.

## 4c. Customer chat on client sites (Chatwoot)

ORBIT drafts replies to site-chat messages; you read, edit and click **Send to customer** in BUSINESS → Niches → Customer chats. Nothing is sent without that click.

1. Run Chatwoot with Docker (official compose, about 2 GB RAM): `curl -fsSL -o docker-compose.yaml https://raw.githubusercontent.com/chatwoot/chatwoot/develop/docker-compose.production.yaml`, `curl -fsSL -o .env https://raw.githubusercontent.com/chatwoot/chatwoot/develop/.env.example`, set `SECRET_KEY_BASE`, `FRONTEND_URL` and the Postgres password in `.env`, then `docker compose run --rm rails bundle exec rails db:chatwoot_prepare` and `docker compose up -d`. Open it, create the account, add a **Website** inbox and paste its widget script into the client site.
2. In Chatwoot: Profile → Access Token → copy it. ORBIT `.env.local`: `CHATWOOT_URL=` (e.g. http://localhost:3000 of Chatwoot), `CHATWOOT_API_TOKEN=`, `CHATWOOT_WEBHOOK_SECRET=` (see step 3). Restart ORBIT.
3. Chatwoot → Settings → Integrations → Webhooks → Add: URL `https://<ORBIT host>/api/business/chatwoot`, tick **Message created**. Chatwoot must reach ORBIT (same PC: `http://host.docker.internal:<ORBIT port>/...`). Current Chatwoot signs every call (`X-Chatwoot-Signature` = HMAC-SHA256 of `{X-Chatwoot-Timestamp}.{body}`): copy the webhook's secret from Chatwoot into `CHATWOOT_WEBHOOK_SECRET`. ORBIT refuses bad signatures and calls older than 5 minutes. Only an older Chatwoot without signing: set your own 16+ char secret (`openssl rand -hex 24`) and add `?secret=<it>` to the URL.
4. Check: send a chat from the site widget; within a minute a draft shows under Customer chats. Send it and see it appear in the widget. Wrong secret, bad or stale signature → 401; with no secret set ORBIT refuses every call.

## 5. If something fails, send Claude

- The step number and what you expected.
- The newest lines (about 50) of `orbit-server.log`, plus `orbit-build.log` if the build failed and `orbit-launcher.log` if the app did not start (all in the `orbit` folder).
- A screenshot of the screen where it went wrong, with the browser console open (F12 → Console) if the page is blank or an error shows.
- A screenshot of Doctor, for any migration problem.
- For perf: the newest file in `%LOCALAPPDATA%\orbit\perf-runs\` (if `ORBIT_DATA_DIR` is set, it is `perf-runs` under that folder instead).
- Do not send journal or LIFE text, `.env.local` or passwords.
