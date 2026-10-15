# Running ORBIT on Windows

Run these from the ORBIT folder (`C:\Users\andre\Documents\orbit`).

| Command | What it does |
|---|---|
| Desktop **ORBIT** icon | Start the server if needed, then open the ORBIT window |
| `npm run app:start` | Start the server only (no window) |
| `npm run app:stop` | Stop the supervisor and the server |
| `npm run app:rebuild` | Stop, force a fresh production build, start again |
| `npm run app:dev` | Start in development mode (hot reload, slower; header shows **DEV**) |
| `npm run dev` | Plain dev server in this terminal (Ctrl+C to stop) |

How it works:

- `scripts\launch.ps1` runs a **production** server (`npm run start`, port 3000, reachable from this PC only). If `.next\BUILD_ID` is missing or older than anything in `src\`, `package.json`, `next.config.ts` or `.env*`, it runs `npm run build` first (a tray message says so; it can take a few minutes).
- If the build fails, ORBIT starts in **development** mode instead and tells you. Fix the error shown in `orbit-server.log`, then `npm run app:rebuild`.
- A hidden supervisor restarts the server if it crashes (waits 2, 4, 8... up to 60 s; gives up after 6 crashes in 10 minutes).
- The launcher waits for `http://127.0.0.1:3000/api/health` (`{ ok, mode, uptimeSec }`, no login needed, nothing private).
- Log: `orbit-server.log` (moved to `orbit-server.log.1` above 5 MB, checked at each (re)start).
- The wake listener (`scripts\wake`) and the sign-in auto-start use the same launcher.
- Switching between dev and production: `npm run app:stop` first, then start the one you want. Running `npm run dev` overwrites the production build; the next production start rebuilds automatically.
