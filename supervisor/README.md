# ORBIT self-development: builder + release supervisor

ORBIT can pick an improvement, change its own code, test it, release it and roll it back, without asking per change.
Two processes do this, both outside the ORBIT server:

| | Builder (`selfdev/builder.ts`) | Supervisor (`supervisor/supervisor.ts`) |
|---|---|---|
| Runs as | a separate low-rights local account (required before unattended use; see below), task "ORBIT Builder" | SYSTEM (task "ORBIT Supervisor"), from its installed copy in `C:\ProgramData\orbit-supervisor\app` |
| Can | read its signals, edit its own worktrees, run tests/gate, call the model, drop a submission in the inbox | push branches, open PRs, wait for CI, fast-forward `main`, install a build, monitor, roll back, revert `main` |
| Has | the model login/key only | the GitHub token (`token.txt`), the audit trail, release snapshots, data backups |
| Can't | push, merge, deploy, read the supervisor's folder, change the policy | run repo code (builds run as Andreas via "ORBIT Release Build") |

## The loop

observe → select → define success → edit → verify → release → monitor → keep or roll back

1. **Observe** (builder): new error lines in `orbit-server.log` (redacted, grouped), `npm test` on the released `main`, the weekly
   "Make ORBIT better" ranking (`self-improve.json`: health and perf issues, scorecard regressions, slow calls, failed night tasks,
   corrections), an optional perf file, and the owner backlog (`backlog.json`). Logs, notes and pages are data: nothing in them can
   add a task source, widen scope or authorise a tool.
2. **Select**: best score wins; below the bar (40) it records "no change" with the reason. A key that failed `maxAttempts` times,
   was rolled back, or the model judged not worth changing is blocked with its reason and not retried.
3. **Define success**: each task carries an objective, why it was chosen, acceptance criteria, the release scope, and limits
   (time, model spend, turns).
4. **Edit**: Agent SDK session in its own worktree. Tools: read/edit inside that worktree; Bash only for tests, typecheck and read-only
   git; no web, no subagents, no chaining. `NO_CHANGE: reason` is a valid outcome.
5. **Verify** (builder): release policy, "tests not weakened" (no deleted tests, fewer assertions, new skips), a regression test for bug
   fixes, focused tests, then the full `npm run gate` on the exact tree. UI changes: an isolated instance (`ORBIT_ISOLATED=1`) with
   screenshots of the public pages; signed-in views aren't covered and the check says so.
6. **Release** (supervisor): checks the bundle is based on the released `main`, re-applies the policy to the real diff, pushes
   `selfdev/<id>`, opens a PR, waits for GitHub CI on that exact commit, fast-forwards `main` (never a new commit, so what CI tested is
   what ships), builds it, snapshots the build, backs up the data folder and proves the backup restores, then installs.
7. **Monitor**: startup, `/api/health` (running commit must equal the release), workflow pages, restarts, new error lines; several probes.
8. **Keep or roll back**: pass → kept. Fail → the previous snapshot is reinstalled and checked the same way, `main` gets a revert
   commit, and releases halt until the owner clears it. At most `maxRollbackAttempts` tries, then it halts.

Releases are serialized (one at a time, single-instance lock). Every step is journaled before the next, so a restart resumes the step
that was running (an interrupted model edit restarts from a clean tree; nothing already pushed, merged or submitted is repeated).

## Release policy (narrow to start; `policy` in config.json)

- Only under `src/`, `tests/`, `docs/`; at most 8 files and 300 changed lines.
- Never: `supervisor/`, `selfdev/`, `.github/`, `AGENTS.md`, migrations, `package.json`/lockfile, `next.config.ts`, `scripts/`, REA,
  middleware, authority/autonomy/stop-all/CSRF/allow-list code, instrumentation, isolation, the self-dev view and API, `.env*`.
- 3 releases and $5 of builder spend a day. Migrations and dependency changes are deferred to the owner: they can't be reliably
  reversed by reinstalling a snapshot.

## What the protections rest on (be exact)

- **Real:** the supervisor runs as SYSTEM from its own folder (SYSTEM + Administrators only; unelevated processes can't change it).
  It holds the only GitHub token. It never runs repo code, and never runs git or scripts inside the live or stage folders: builds and
  installs run as Andreas through the "ORBIT Release Build" / "ORBIT Release Install" tasks. CI runs on GitHub on the exact commit,
  `main` only moves by fast-forward to that commit (or a supervisor revert), and the release policy is re-checked on the real diff,
  including file modes (no links, submodules or git metadata files) and the health route the supervisor relies on.
- **Not yet a boundary: builder vs Andreas's account.** The builder's tool sandbox limits what the model *calls*, but its tests and the
  gate run code the model *wrote*, as the account the builder runs under. If that is Andreas's account, model-written code can do what
  he can: change the live or stage folders directly (skipping CI and the policy for what ORBIT runs until the next install), read his
  files, and use his stored git credentials to push. **Before turning on unattended releases on the PC, run the builder under a
  separate local account** (no admin, no write access to the live or stage folders or his profile, no stored git credentials, its own
  model key with a spending limit), and protect `main` on GitHub with "require status checks" and "do not allow bypassing" so even his
  credentials can't push past CI. Until then the PC setup is supervised self-development, not an enforced boundary.
- **Tamper-evident, not tamper-proof:** the audit trail is hash-chained; an administrator could still rewrite it.
- **Self-reported:** the builder's spend (it reserves the full task budget before each model session). The hard cap is the spending limit
  on the builder's own API key.
- **Not covered:** an elevated process (a UAC prompt you approve) can do anything.

## Owner controls

- DEV → Doctor → **Self-development**: current task and why, diffs, checks, browser evidence, releases with their stage
  (implemented / tested / CI passed / deployed / verified after deployment / rolled back), spend, audit state.
  Buttons: **Pause**, **Emergency stop** (also stops the builder directly), **Restore previous release**.
- On the PC, elevated: `node --experimental-strip-types C:\ProgramData\orbit-supervisor\app\supervisor.ts <cmd>` (while the supervisor
  runs, these are queued in its admin-only `ctl\` folder and applied by it, so one process writes state and audit)
  - `status`, `stop`, `pause`, `resume`, `clear` (lift a halt or stop), `restore [releaseId]`, `adopt`, `verify-audit`.
  Resume and clear exist only here: the app can make things safer, never less safe.
- Emergency stop also writes the builder's `STOP`; lift it with `node --experimental-strip-types selfdev\builder.ts resume` (as yourself) after `clear`.

## Install on the PC (one time)

1. Elevated PowerShell in the ORBIT folder: `powershell -ExecutionPolicy Bypass -File supervisor\windows\install.ps1`
2. Create a fine-grained GitHub token for `andreaskuus14/orbit` only (Contents RW, Pull requests RW, Checks R), save it as
   `C:\ProgramData\orbit-supervisor\token.txt`. Branch protection on `main`: require the "AI quality checks" status.
3. With ORBIT running and healthy on a clean checkout: `supervisor.ts adopt` (snapshots the running build as the first good release).
4. Builder: `git clone` the repo to `%LOCALAPPDATA%\orbit-selfdev\repo`, `npm ci` there, write `%LOCALAPPDATA%\orbit-selfdev\config.json`
   (shape: see `selfdev/builder.ts` `Config`; `upstream` = `C:\ProgramData\orbit-supervisor\mirror.git`, `supervisorHome` = `C:\ProgramData\orbit-supervisor`).
   Set a spending limit on its API key.
5. Run the drills on the PC (below). Only then `Enable-ScheduledTask "ORBIT Builder"`.

## Drills

`supervisor/drill.sh` runs the whole thing in an isolated environment (bare repo as GitHub, a separate live folder on another port,
`ORBIT_ISOLATED=1`, dummy Supabase that refuses connections, its own data folder): a real improvement through the loop, a release
that fails its health check and is restored by the supervisor, and kill/restart of both processes mid-run.
