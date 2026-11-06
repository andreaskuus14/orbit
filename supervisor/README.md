# ORBIT self-development: builder + release supervisor

ORBIT can pick an improvement, change its own code, test it, release it and roll it back, without asking per change.
Two processes do this, both outside the ORBIT server:

| | Builder (`selfdev/builder.ts`) | Supervisor (`supervisor/supervisor.ts`) |
|---|---|---|
| Runs as | `orbit-builder`, a separate standard account (task "ORBIT Builder", S4U) | SYSTEM (task "ORBIT Supervisor"), from its installed copy in `C:\ProgramData\orbit-supervisor\app` |
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

**Accounts.** Three, and the boundary is between them:

| Account | Holds | Runs |
|---|---|---|
| SYSTEM (supervisor) | GitHub token, config, state, audit trail, its own code and install scripts, release snapshots, data backups, the mirror | merge (fast-forward), CI wait, policy, snapshot, monitor, rollback. Never repo code; never git or scripts inside the owner's folders |
| Andreas (owner) | the live install, the stage build, ORBIT's data, his own git login | ORBIT itself, plus "ORBIT Release Build" / "ORBIT Release Install" (code that already passed the policy and CI) |
| `orbit-builder` (standard user, no admin, no git credentials) | `C:\orbit-builder` only | the builder, its model session, and every test and gate run, i.e. all **model-written code that hasn't been released** |

Model-written tests are executable code, and so is anything the gate runs. They run only as `orbit-builder`. From there they can create
files in `inbox\` and read `public\` and the mirror, and nothing else of the supervisor's or the owner's. Install scripts are the supervisor's
own copies (`app\windows\*.ps1`), not repo files; the ones they call in the live folder (`scripts\stop.ps1`, `launch.ps1`) are on the
release policy's deny list, so only an owner-reviewed PR changes them. Dependency changes (and with them npm install scripts) are denied too.

**Proven on Linux** (`sudo bash supervisor/boundary-check.sh`): the same three-account layout with POSIX permissions in place of the ACLs,
and `boundary-probe.mjs` run as a test (`node --test`) from a builder worktree under the builder account. It could not read the token or
config; write state, audit, STOP, `ctl\`, the supervisor's code or install scripts, snapshots, or the mirror's `main`; list, change or
delete other inbox files; touch the live install (source, `.git` config or hooks, `.env.local`, `.next`), the stage build or its result
file, or ORBIT's data and Stop-all; push to `main`; or signal the supervisor or read its environment. It could create a submission and
read status and the mirror. **The Windows ACLs from `install.ps1` are not verified yet**: run the same probe there (see "Enabling").

**"CI must pass" without branch protection.** This repo's GitHub plan doesn't offer branch protection or rulesets, so GitHub itself won't
refuse a push to `main` that skipped CI. What enforces it instead:
- Only the supervisor holds a credential that can write to the repo, and it merges a commit only after the configured
  `github.requiredChecks` (the `check` job of "AI quality checks") succeeded **on that exact commit**. A different check passing, a
  skipped check, or no run at all doesn't count.
- The builder has no GitHub credential, and the PR can't change the workflow (`.github/` is denied, and the supervisor re-checks the real diff).
- **Gap:** Andreas's own git login can still push to `main` directly, as today. That's the owner's choice, not something the loop can
  prevent. If the plan changes to one with branch protection, add it as a second layer.

**Tamper-evident, not tamper-proof:** the audit trail is hash-chained; an administrator could still rewrite it.
**Spend:** the builder reserves its full task budget before each model session; the hard cap is the limit on `orbit-builder`'s own API key.
**Not covered:** an elevated process (a UAC prompt Andreas approves) can do anything.

## What a rollback restores, and what it doesn't

| | On rollback |
|---|---|
| ORBIT's code and build | **Restored**: the previous release's snapshot is reinstalled and checked (health, its commit, pages) before it counts |
| `main` on GitHub | **Restored**: a new revert commit with the previous tree (history kept, nothing force-pushed) |
| ORBIT's data folder (local stores, vault index) | **Kept as it is.** Backed up before every install, with a verified restore, but **not restored automatically**: that would drop everything written since the deploy. The rollback records which files changed since the backup (audit `rollback.data`) and where the backup is, so the owner can restore by hand if the failed release damaged something |
| Supabase | **Untouched.** Unattended releases can't add migrations, so the schema never changes; rows written by the failed release stay |
| Outside effects (messages, posts, purchases) | **Not reversible**; still owner-approved per item (AGENTS.md rule 6), never released automatically |

A release that changes the format of a local store could leave data the older code can't read; since #413, stores fail closed (that
feature is blocked, never saved over). If that happens, the rollback note lists the files; restore them from the backup or fix forward.

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

1. Create the builder account: `net user orbit-builder * /add` (standard user; never sign in with it; no git or GitHub credentials).
2. Elevated PowerShell in the ORBIT folder: `powershell -ExecutionPolicy Bypass -File supervisor\windows\install.ps1`
3. A fine-grained GitHub token for `andreaskuus14/orbit` only (Contents RW, Pull requests RW, Checks R) in
   `C:\ProgramData\orbit-supervisor\token.txt`.
4. With ORBIT running and healthy on a clean checkout: `supervisor.ts adopt`. Run `install.ps1` once more so the mirror gets its read grants.
5. As `orbit-builder`: clone `C:\ProgramData\orbit-supervisor\mirror.git` to `C:\orbit-builder\repo`, `npm ci`, write
   `C:\orbit-builder\config.json` (`upstream` = the mirror, `supervisorHome` = `C:\ProgramData\orbit-supervisor`), and give it its own
   model key with a spending limit.

## Enabling (all on the PC; until then `enabled: false` and the "ORBIT Builder" task stays disabled)

1. **Account isolation:** as `orbit-builder`, `node --test supervisor\boundary-probe.mjs` with the real paths (`PROBE_SUP`, `PROBE_LIVE`,
   `PROBE_STAGE`, `PROBE_DATA`, `PROBE_SUP_PID`). Every check must pass.
2. **Install:** the "ORBIT Release Build" and "ORBIT Release Install" tasks build and install a release while ORBIT stays healthy, and
   Doctor shows the released commit.
3. **Stop:** DEV → Doctor → Emergency stop holds a queued release and ends the builder; ORBIT's own Stop-all holds releases too.
4. **Rollback:** a deliberately broken release (like `drill.sh` step 2b) is detected, the previous build is restored and healthy, `main` is
   reverted, releases halt, and data written after the deploy is listed and kept.
5. Then set `enabled: true` in `config.json`, restart "ORBIT Supervisor", and `Enable-ScheduledTask "ORBIT Builder"`.

## Drills

- `npm run drill:supervisor` (`supervisor/drill.sh`, ~12 min, no model, no network, no live data): a bare repo stands in for GitHub; a
  separate live folder on its own port runs `ORBIT_ISOLATED=1` with a dummy Supabase and its own data folder. It checks that releases
  stay queued while disabled, a good release survives a supervisor kill mid-monitoring with merge and build run once, a health-route
  change is refused, ORBIT's Stop-all (on or damaged) holds a release, a broken release is rolled back with `main` reverted and the
  post-deploy data recorded and kept, the app can't clear a halt, emergency stop works, and the audit chain is intact.
- `sudo bash supervisor/boundary-check.sh`: the builder account boundary (above).
- The full loop with a real model (builder picks, edits, verifies; supervisor releases) was run by hand in an isolated copy; see #417.
