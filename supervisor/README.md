# ORBIT self-development: builder + release supervisor

ORBIT can pick an improvement, change its own code and test it; the owner approves each release on the PC; the supervisor then
merges, installs, monitors and, if needed, rolls it back.
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
   `selfdev/<id>`, opens a PR, waits for GitHub CI on that exact commit, then **waits for the owner's approval** (below), fast-forwards
   `main` (never a new commit, so what CI tested is what ships), builds it, snapshots the build, backs up the data folder and proves the backup restores, then installs.
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

**Accounts.** Four, and the boundary is between them:

| Account | Holds | Runs |
|---|---|---|
| SYSTEM (supervisor) | GitHub token, config, state, audit trail, its own code and install scripts, release snapshots, data backups, the mirror | merge (fast-forward), CI wait, policy, snapshot, monitor, rollback. Never repo code; never git or scripts inside anyone else's folders |
| Andreas (owner) | the live install, ORBIT's data and `.env.local`, his own git login | ORBIT itself, and "ORBIT Release Install": stop ORBIT, swap the snapshot in, check out, start. Runs no submitted code until the released app starts |
| `orbit-build` (standard user) | `C:\orbit-stage`, `C:\orbit-build-cache` | "ORBIT Release Build": a fresh clone of the mirror, a fresh `npm ci` (dependency install scripts run here), `next build` (submitted code runs here at build time). Gets only `NEXT_PUBLIC_*` values, never `.env.local`; every process of this account is ended before the supervisor copies the build, and the copy never follows links |
| `orbit-builder` (standard user) | `C:\orbit-builder` | the builder, its model session, and every test and gate run on unreleased, model-written code |

**Untrusted code runs only as `orbit-build` or `orbit-builder`.** That covers model-written tests, gate commands, build-time code and
dependency install scripts. Neither account can read the token or the supervisor's config, or change its state, audit, code, install
scripts, snapshots or the mirror's `main`. Neither can touch the live install, ORBIT's data or Stop-all, or push to `main`.
The builder may add files to `inbox\`, and only its own; the build account may not. Both may read `public\` and the mirror. The
supervisor's install scripts are its own copies (`app\windows\*.ps1`). The live-folder scripts they call (`scripts\stop.ps1`,
`launch.ps1`) are protected by the release policy, so only an owner-reviewed PR changes them.

**Proven on Linux** (`sudo bash supervisor/boundary-check.sh`, POSIX permissions standing in for the ACLs; each account starts with an
empty environment, as a scheduled task does). `boundary-probe.mjs` runs:
1. as a builder test (`node --test` in its clone of the mirror);
2. from a dependency's `postinstall` in the stage, as `orbit-build`;
3. from a submitted page executed by `next build`, as `orbit-build`.

Every forbidden action was refused in all three.

**Windows:** `.github/workflows/selfdev-windows.yml` runs `supervisor\windows\ci-verify.ps1` on a throwaway `windows-latest` VM. It
covers the installer, the same probes under the real accounts and scheduled tasks, the release pipeline, Stop-all, a locked live
file, rollback and emergency stop. See #417 for which runs passed. The PC itself still needs the same checks ("Enabling").

**CI enforcement is an application-level control, not branch protection.** This repo's GitHub plan offers no branch protection or
rulesets, so GitHub won't refuse a push to `main` that skipped CI. The supervisor enforces it instead:
- Only the supervisor holds a credential that can write to the repo.
- It merges a commit only after `github.requiredChecks` (the `check` job of "AI quality checks") succeeded **on that exact commit**.
  A missing, skipped or different check doesn't count.
- The builder has no GitHub credential. A submission can't change the workflow, the gate scripts, `tsconfig.json`, the evals or the
  release policy: they are denied (case-insensitively, including Windows short-name and stream aliases), and existing test fixtures
  can't be changed. The code the eval loads into its own process is protected too.
- CI runs the submission's code, so its stages are separate jobs: `tests` and `build` each on a fresh VM, and `check` (typecheck +
  eval) only after both passed. A test can't rewrite the eval runner or the build. `npm test` loads `scripts/test-guard.mjs`, so a
  test file that ends its own process counts as failed, not passed; the tests job also fails if committed files changed.
- Limit: inside the `tests` job, one test file could still change another before it runs and put it back afterwards. The job
  separation, the guard and the supervisor's static checks raise the bar; they aren't a sandbox. Monitoring and rollback after
  deployment remain the backstop.

This is **not equivalent** to GitHub-enforced branch protection. Anyone with a write credential, Andreas's own git login included, can
still push to `main` without CI. The supervisor's control only holds as long as it is the only writer the loop uses. If the plan ever
allows branch protection, add it as a separate, GitHub-side layer.

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

**Install downtime.** ORBIT is stopped for the swap (its own files are open while it runs). A swap that fails, e.g. on a file locked by
antivirus, puts the previous build back and restarts it, so each failed attempt costs ORBIT a restart (seconds); after
`maxRollbackAttempts` the supervisor halts and leaves ORBIT on the previous build.

## Owner approval (required before merge and install)

A release that passed the policy and CI stops at `checked` and waits: status `awaitingApproval` and the Self-development view show its id
and commit. Nothing reaches `main` or the live app until the owner runs, on the PC, elevated:

    node --experimental-strip-types C:\ProgramData\orbit-supervisor\app\supervisor.ts approve <releaseId> <full 40-character commit>

- Only through `ctl\` (Administrators/SYSTEM only). The inbox, which the app and the builder can both write to, can't approve; the app
  has no approve button; the builder has no way to reach `ctl\` (the boundary probe checks it).
- Bound to that release id and that exact commit, accepted only while that release waits at `checked`. Refused and audited
  (`approval.rejected`): missing id or commit, an abbreviated commit, another commit (stale or mismatched), another or no release in
  progress, an approval sent before CI passed (it isn't kept for later), and any approval for a release that is already approved or
  ended (no reuse). Accepted: audit `release.ownerApproved`, journaled, so a restart doesn't ask again.
- No approval within `approvalTimeoutSec` (default 3 days): the release is rejected; nothing was merged or installed.
- Drills: `drill.sh` (1), `ci-drill.sh` (1b) and `windows\ci-verify.ps1` prove each refusal and that an approved release proceeds. In the
  drills after that, the harness approves each waiting release the way the owner would.

## Owner controls

- DEV → Doctor → **Self-development**: current task and why, diffs, checks, browser evidence, releases with their stage
  (implemented / tested / CI passed / deployed / verified after deployment / rolled back), spend, audit state.
  Buttons: **Pause**, **Emergency stop** (also stops the builder directly). Approve and restore aren't buttons: they are owner commands on
  the PC (below), because the inbox the app writes to is writable by the builder too, and the supervisor accepts only pause and stop there.
- On the PC, elevated: `node --experimental-strip-types C:\ProgramData\orbit-supervisor\app\supervisor.ts <cmd>` (while the supervisor
  runs, these are queued in its admin-only `ctl\` folder and applied by it, so one process writes state and audit)
  - `status`, `approve <releaseId> <commit>`, `stop`, `pause`, `resume`, `clear` (lift a halt or stop), `restore [releaseId]`, `adopt`,
    `verify-audit`.
  Approve, restore, resume and clear exist only here: the app can make things safer, never less safe. A requested rollback
  (`restore`) needs the owner; the supervisor's own recovery from a failed install or failed monitoring still runs by itself.
- **Disabling vs. stopping.** `enabled: false` only stops the supervisor from *starting* new releases: queued submissions stay in the
  inbox. A release already in progress is not cancelled by it (also not by a restart): it continues from its journaled step, which is
  at most the approval wait unless you approved it.
  - **Pause** (app or `pause`): holds the release in progress at its next step boundary (before merge if it hasn't merged yet, at the
    latest before install), and starts nothing new. Lift with `resume` on the PC.
  - **Emergency stop** (app or `stop`): the same hold plus the builder's `STOP` file and its task ended; it takes effect even while the
    supervisor is busy. Lift with `clear`, then `builder.ts resume`.
  - Neither interrupts an install that has started: once the live app is being swapped, the supervisor finishes it, monitors it, and
    rolls back on failure, so ORBIT is never left half-installed.
- Emergency stop also writes the builder's `STOP`; lift it with `node --experimental-strip-types selfdev\builder.ts resume` (as yourself) after `clear`.

## Install on the PC (one time)

1. Create two standard accounts: `net user orbit-builder * /add` and `net user orbit-build * /add` (never sign in with them; no git or GitHub credentials).
2. Elevated PowerShell in the ORBIT folder: `powershell -ExecutionPolicy Bypass -File supervisor\windows\install.ps1`
3. A fine-grained GitHub token for `andreaskuus14/orbit` only (Contents RW, Pull requests RW, Checks R) in
   `C:\ProgramData\orbit-supervisor\token.txt`.
4. With ORBIT running and healthy on a clean checkout: `supervisor.ts adopt`. Run `install.ps1` once more so the mirror gets its read grants.
5. As `orbit-builder`: clone `C:\ProgramData\orbit-supervisor\mirror.git` to `C:\orbit-builder\repo`, `npm ci`, write
   `C:\orbit-builder\config.json` (`upstream` = the mirror, `supervisorHome` = `C:\ProgramData\orbit-supervisor`,
   `testRunner` = `{ "reqDir": "C:\\orbit-test\\req", "outDir": "C:\\orbit-test\\results" }`), and give it its own model key with a
   spending limit.
6. `net user orbit-test * /add`, then elevated: `powershell -ExecutionPolicy Bypass -File supervisor\windows\install-test-runner.ps1`
   (after step 5, so the builder's `node_modules` exists). Not yet done on the PC: see "Test runner".

## Enabling (all on the PC; until then `enabled: false` and the "ORBIT Builder" task stays disabled)

1. **Account isolation:** the probe as `orbit-builder` (`node --test supervisor\boundary-probe.mjs`) and as `orbit-build`
   (`PROBE_ROLE=build node supervisor\boundary-probe.mjs --report ...`) with the real paths (`PROBE_SUP`, `PROBE_LIVE`, `PROBE_STAGE`,
   `PROBE_DATA`, `PROBE_OWN`, `PROBE_SUP_PID`); `supervisor\windows\ci-verify.ps1` shows how. Every check must pass.
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
- `npm run drill:ci` (`supervisor/ci-drill.sh`, ~3 min, no network): the real supervisor against a stand-in GitHub API. A release merges only when
  the required check succeeded on that exact commit (failed, skipped, missing, cancelled, still running, passed elsewhere, or another check
  failing are refused), and every way of weakening the checks (workflow, gate/test scripts, test guard, eval runner and the code it loads,
  policy, tsconfig, deleted/emptied/skipped tests, a test ending its process, `@ts-nocheck`) is refused before anything is pushed.
- `sudo bash supervisor/boundary-check.sh`: the builder account boundary (above).
- The full loop with a real model (builder picks, edits, verifies; supervisor releases) was run by hand in an isolated copy; see #417.

## Test runner: model-written code never runs where the model credential is (#417 gaps D and E)

The builder's account holds the model credential and its spending settings (`config.json`, `state.json`). So nothing it runs may be
code from the repo or the model: every test, typecheck, gate, build and browser check runs as a fifth account, `orbit-test`.

| Path | Before | Now |
|---|---|---|
| Edit session (the model's tools) | Bash ran `node --test`, `npm test`, `npx tsc` with `ANTHROPIC_*`/`CLAUDE_*` in its environment | `editToolDecision` (`selfdev/builder-pure.ts`) allows only read-only Bash (`git diff/status/log/show`, `ls`, `cat`, `head`, `tail`, `grep`, `rg`, `wc`, no shell syntax, no `--pre`/`--ext-diff`/`--textconv`), no reads or writes in `node_modules` or `.git`. Tests go through the `run_tests` tool |
| Builder verification | focused tests, gate and the isolated app ran as the builder (model variables removed, files and profile still reachable) | the same kinds, as requests to the runner, on a snapshot commit of the worktree |
| Tests on released main | `npm test` as the builder | kind `test`, as `orbit-test` |

**How a request runs.** The builder writes `<id>.json` (`{ id, task, commit, base, kind, files }`, kinds `focused`, `typecheck`,
`test`, `gate`, `screens`; files only `tests/<name>.test.ts`) and a bundle to `C:\orbit-test\req\` (create-only). The supervisor
checks the shape (`testRequestProblem`), starts the "ORBIT Test Runner" task through `windows\trigger-test.ps1`, and ends every
`orbit-test` process afterwards. `test-run.ts` makes a disposable checkout of exactly that commit (mirror + bundle, hooks off),
links the builder's `node_modules` read-only, builds the environment from nothing (no model, GitHub, proxy or Supabase variable;
`HOME` and temp inside its work folder; `ORBIT_ISOLATED=1`), runs the fixed commands and writes `C:\orbit-test\results\<id>.json`
once. The supervisor audits each run (`test.run`, `test.refused`).

**Rights of `orbit-test`** (`windows\install-test-runner.ps1`): standard user; batch logon only (interactive and remote desktop
denied); read on its requests, the supervisor's code folder, the mirror and the builder's `node_modules`; modify on its own results
and work folders; nothing else of the builder's, the supervisor's or the owner's. Outbound: one Windows Firewall block rule for the
account on every non-loopback address.

**What is proven where**

- Linux (`boundary-check.sh`): the probe runs as a model-written test through the real broker and runner, in a private network
  namespace. Refused: the builder's key file, login and process environment, its config and state, the supervisor's credentials,
  code and state, ORBIT's data and Stop-all, and every outbound connection (itself, a child, a grandchild through the shell, the
  host's loopback proxy, DNS). A negative control without the namespace reaches the proxy. A real ORBIT test passes the same way.
  Canary credentials appear in no file the runner wrote; spending settings are unchanged.
- Windows (`windows\ci-test-runner.ps1`, workflow "Self-dev test runner (Windows)", disposable VM): the same probe through the SYSTEM
  supervisor and the task, with the firewall rule; a negative control with the rule disabled.
- Edit session (`tests/selfdev-builder.test.ts`): with a fake key in the environment, each allowed command is executed against a
  checkout planted with a malicious test, package scripts and a fake `node_modules/.bin/tsc`; none of them runs and the key never
  appears.

**Limits on Windows** (a per-user firewall rule can't cover them; reported by the probe, not hidden):

- Loopback isn't filtered by Windows Firewall: a test can reach services listening on the PC's `127.0.0.1`, live ORBIT on :3000
  included (its routes still require a signed-in session).
- Names are resolved by the DNS Client service, not by the test's process, so a lookup of a crafted name leaves the machine.
- Closing both needs a stronger box than an account: an AppContainer, Windows Sandbox or a VM for the runner.

The runner protects secrets and spending settings. It doesn't make the builder's own pass/fail trustworthy (a test can still fake
its own result): the supervisor's policy check, CI on the exact commit and the owner's approval decide.
