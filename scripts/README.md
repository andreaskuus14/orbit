# Running ORBIT on Windows

Run these from the ORBIT folder (`C:\Users\andre\Documents\orbit`).

| Command | What it does |
|---|---|
| Desktop **ORBIT** icon | Start the server if needed, then open the ORBIT window |
| `npm run app:start` | Start the server only (no window) |
| `npm run app:stop` | Stop the supervisor and the server (only ORBIT's own processes) |
| `npm run app:rebuild` | Force a fresh production build; if it succeeds, swap it in and restart. If it fails, the current version keeps running (exit code 1) |
| `npm run app:dev` | Start in development mode (hot reload, slower; header shows **DEV**) |
| `npm run dev` | Plain dev server in this terminal (Ctrl+C to stop) |

How it works:

- `scripts\launch.ps1` runs a **production** server (`npm run start`, port 3000, reachable from this PC only) from `.next`. If `.next\BUILD_ID` is missing or older than anything in `src\`, `package.json`, `next.config.ts` or `.env*`, it builds first (a tray message says so; it can take a few minutes).
- Builds never replace a working version: they go into `.next-build` (`ORBIT_DIST_DIR`, read by `next.config.ts`) while the current server keeps running. Only when the build succeeds is the server stopped, `.next` renamed to `.next-prev` (exactly one previous version is kept), `.next-build` renamed to `.next`, and the server started again.
- If the build fails, ORBIT keeps (or restarts) the last working version and says **"Build failed - still running the previous version. Fix the errors, then npm run app:rebuild"** (terminal, `orbit-launcher.log`, and a message box when you start it from the icon). The build errors are in `orbit-build.log`. It doesn't retry the same failed build on every start or wake; editing a file or `npm run app:rebuild` does. Only when there is no working version at all does it fall back to **development** mode, and it says so.
- `npm run app:start`, the wake listener and the sign-in auto-start don't wait for an update build when the current version is running: they return at once and a hidden copy of the launcher builds and swaps the update in (the server restarts for a few seconds when it's done).
- Roll back by hand: `npm run app:stop`, rename `.next` to `.next-bad` and `.next-prev` to `.next`, then `npm run app:start`.
- A hidden supervisor restarts the server if it crashes (waits 2, 4, 8... up to 60 s; gives up after 6 crashes in 10 minutes).
- `npm run app:stop` kills only processes it can prove are ORBIT's: the PIDs in `orbit-server.pid` (written by the supervisor) or processes whose command line, or a parent's, names this folder and the launcher, npm or Next. Anything else on port 3000 is reported and left running.
- The launcher waits for `http://127.0.0.1:3000/api/health` (`{ ok, mode, uptimeSec, buildId }`, no login needed, nothing private).
- Logs: `orbit-server.log` (server output), `orbit-build.log` (last build), `orbit-launcher.log` (launcher and supervisor messages). The server and launcher logs move to `.1` above 5 MB, checked at each (re)start.
- The wake listener (`scripts\wake`) and the sign-in auto-start use the same launcher.
- The overnight run (`scripts\night`, `npm run night:install`) wakes the PC, starts ORBIT the same way, lets the scout and clip jobs finish, then sleeps the PC. See `scripts\night\README.md`.
- While ORBIT runs, rebuild with `npm run app:rebuild`, not `npm run build`: a plain build writes straight into `.next` under the running server. (If you do, the next launch or wake notices the new build and restarts the server on it.)
- `npm run dev` / `app:dev` use their own folder, `.next-dev`, so they never touch the production build. Switching between dev and production: `npm run app:stop` first, then start the one you want.
