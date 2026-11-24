# ORBIT in the cloud ("brain" on a server, laptop = GPU)

Preparation only. Nothing is rented or deployed. When you want it: rent a small Linux server, copy one file, run one command.

```
phone ──HTTPS──> Caddy ──> ORBIT (ORBIT_ROLE=cloud) ──> Supabase <──(laptop connects out)── laptop ORBIT (GPU worker)
```

The laptop never needs an open port. Its GPU worker connects **out** to Supabase every 5 s and asks for a job
(`claim_gpu_job`, docs/gpu-queue.md). The cloud ORBIT only puts jobs in the `gpu_jobs` table.

## What works on the cloud, and what still needs the laptop

Works on the cloud (always on): CORE chat (Claude), memories, missions, goals, agents, automations, briefings, phone app and
pushes, BUSINESS records, REACH and web reading (plain fetch, no Chrome), STUDIO numbers, LIFE habits and reminders, workspaces.

Goes into the queue and waits for the laptop: pictures, picture edits, video, music, 3D, voiceover (`local_*` tools).
When the laptop is off, CORE says "queued" and the job runs when the laptop is back.

Needs the laptop (the cloud answers "This runs on the laptop"):
- PC helper (open apps, files, window), desk voice listener, terminal, code sandbox, git, dev sessions, self-update
- Roblox Studio / Rojo / Luau, Blender renders, ComfyUI, Ollama (local brain + OCR), local speech-to-text
- STUDIO clip factory (ffmpeg, yt-dlp, inbox, scout), night shift, Kaggle
- YouTube / Google Calendar sign-in (they only accept `localhost:3000`); do them on the laptop

Not moved yet (known gaps):
- **Results of GPU jobs** are saved as files on the laptop. The cloud gets the job's text, not the file.
- **VAULT**: the laptop copy stays the main copy. The cloud sees files that have a cloud copy (Supabase `vault` bucket)
  and can restore them to its own disk; there is no two-way sync yet.
- **Local data stores** (`%LOCALAPPDATA%\orbit`: life.json, workspaces, OAuth tokens …) are not copied. The cloud starts
  with an empty `/data` volume. Things in Supabase (memories, missions, prospects, jobs) are shared.
- Only the briefing scheduler has an off switch. The laptop's other loops (Herald, results check) still run there too.

## Journal

The journal key stays on the laptop. Without it the cloud **can't read or write** the journal: entries show as locked,
and writing one there gives "The journal can only be written on the laptop". It never stores plain text.
If you ever want it on the server, copy the key file into the volume and set `ORBIT_JOURNAL_KEY_FILE`; your choice.

## Costs (honest)

- Server: 2 vCPU / 4 GB RAM / 40 GB disk, about €4–10 a month (Hetzner, Netcup, OVH and others; check today's price).
  2 GB is too little: the build needs about 3 GB.
- Domain: about €1 a month (or a free subdomain from a DNS service you already use).
- Supabase: the free plan you use now. Claude: your Max plan, no API bill.
- The laptop's power while it works GPU jobs, as today.

## Step by step

1. **Pick a provider** and create an Ubuntu 24.04 server, 4 GB RAM, with your SSH key. Note its IP address.
2. **Domain**: add an A record, e.g. `orbit.yourname.ee` → the server IP.
3. **Install Docker** on the server: `curl -fsSL https://get.docker.com | sh`
4. **Firewall**: allow only 22, 80, 443 (`ufw allow 22,80,443/tcp && ufw enable`).
5. **Get the code**: `git clone https://github.com/andreaskuus14/orbit && cd orbit`
6. **Claude token**: on the laptop run `claude setup-token` and copy the token.
7. **Settings**: `cp docs/cloud.env.example deploy/cloud/.env && chmod 600 deploy/cloud/.env`, then fill it in
   (domain, the same Supabase values as the laptop, `ORBIT_ALLOWED_EMAILS` = your email, the Claude token).
   With `ORBIT_ALLOWED_EMAILS` empty, nobody can sign in on the cloud.
8. **Supabase**: Authentication → URL configuration → add `https://<your domain>/auth/callback` to the redirect URLs.
   Run migration `0029_gpu_jobs.sql` if you haven't.
9. **Start** (the one command):
   `docker compose -f deploy/cloud/docker-compose.yml --env-file deploy/cloud/.env up -d --build`
   Check: `https://<your domain>/api/health` shows `"role":"cloud"`.
10. **Laptop**: in `.env.local` set `ORBIT_GPU_QUEUE=1` (works the queued jobs) and `ORBIT_SCHEDULER=0`
    (the cloud sends the briefings, so you don't get them twice). Restart ORBIT.
11. **Phone**: open `https://<your domain>` and sign in, then Add to Home Screen. Pair the phone again in that ORBIT
    (pairing and pushes belong to the server you paired with).

Update later: `git pull` then the same command as step 9. Logs: `docker compose -f deploy/cloud/docker-compose.yml logs -f orbit`.

## Security

- Every page and API needs your sign-in (middleware.ts), and only emails in `ORBIT_ALLOWED_EMAILS`.
- HTTPS by Caddy (automatic certificate, HSTS). ORBIT's port 3000 is not published; only Caddy is reachable.
- Per-IP limits on the public paths (sign-in callback, login, phone pairing, pitch links): `role-pure.ts` `RATE_LIMITED`.
  Password tries go to Supabase, which has its own limits.
- Laptop-only and admin routes (terminal, self-update, PC helper …) answer 503 on the cloud, and Caddy blocks the
  loopback helpers. The container runs as the non-root `node` user with no extra capabilities.
- Secrets live only in `deploy/cloud/.env` on the server (git-ignored). The Supabase secret key and Claude token there
  can reach your data and your Claude plan: treat the server like your laptop.

## Not tested

Built and checked here: the role switch and its tests, `docker compose config`. Not run: the Docker image build, Caddy,
a real server, Claude CLI with `CLAUDE_CODE_OAUTH_TOKEN` in the container, the laptop working jobs a cloud queued.
