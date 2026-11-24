# Smoke tests

## `npm run smoke` (no sign-in)

Browser check of the pages that work without signing in (/demo, /remote, /screen, /login). See the top of `scripts/smoke.mjs`.

## `npm run smoke:live` (after an update, on the laptop)

One command that checks the ORBIT that is running right now, signed in as you. Run it after an update, from the repo folder.

It only reads. It sends only GET requests. In the browser part, every other request the page tries (saves, pings) is blocked and listed in the report. Nothing is sent, published or spent.

### One-time: save your session cookie

1. Open ORBIT in your browser (http://127.0.0.1:3000) while signed in.
2. Press F12, open **Network**, reload, and click any `/api/...` request.
3. Under **Request Headers**, copy the whole `cookie` value.
4. Paste it into `.smoke-cookie.txt` in the repo folder (it is git-ignored). A JSON array of `{name, value}` from a cookie export add-on also works.

When the run says "cookie missing or expired", do this again. Keep the file private: it is your sign-in.

### Run

```
npm run smoke:live
```

Settings (optional): `SMOKE_BASE` (default `http://127.0.0.1:3000`), `SMOKE_COOKIE_FILE` (default `.smoke-cookie.txt`), `SMOKE_OUT` (default `smoke-shots`), `SMOKE_BROWSER=0` to skip the browser part.

### What it checks

- `/api/health` answers and its `commit` is the same as `git rev-parse HEAD` (a different one means the old build is still running).
- Each planet's main read route: VAULT, STUDIO (YouTube link status), OPERATIONS (tasks), MEMORY, AGENTS status poll, ANALYTICS summary, BUSINESS overview, LIFE lite (fails if any journal or notes field is in the answer), ARCH, GAME DEV.
- Earth: one map tile, local, region (Helsinki), buildings for one Tallinn tile. If the outside map or Overpass service is down, the route must say "offline"; that is a WARN, not a FAIL.
- A news picture (a picture or "none" are both fine).
- `/m/manifest.webmanifest` without a cookie, and the `/m` page.
- `/api/gpu-jobs` with the GPU queue off answers `on: false` and no jobs (WARN if the queue is on).
- No 5xx answers.
- If Playwright is in the repo and a browser is found (Playwright's Chromium, else Edge, else Chrome): opens home and every planet headless at 1440×900, and records console errors, long tasks, 5xx answers and blocked writes, with one screenshot each.

### Output

A short PASS / WARN / FAIL table, and `smoke-shots/live-<date>_<time>/report.json` with screenshots next to it. Exit code 1 if anything failed.
