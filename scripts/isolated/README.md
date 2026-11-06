# Isolated signed-in checks

End-to-end checks of ORBIT's recovery paths through the real signed-in UI, without touching the live ORBIT, its Supabase or any
real account:

| Check | What it proves |
|---|---|
| `basic` | **Retry** re-runs a failed task exactly once, and a second Retry while it runs is refused. **Cancel** stops a running task and ends its model process. **Stop-all** cancels running tasks, holds new ones, and Resume starts them. |
| `restart` | **SIGKILL mid-task:** the task is marked interrupted and Retry runs it once. **Interrupted approved action:** an approved `create_project` is killed mid-write, in two variants (the write lands after the crash, or never does). The step shows "may or may not have happened" and re-running the agent is refused. Resume ends with exactly one project. |
| `pair` | A failed pairing attempt (wrong code, or a right code whose device can't be saved) doesn't use up a valid code. |
| `coldstart` | With `stop-all.json` on, unreadable or damaged at boot, a task queued before boot never starts. A control run with it off does start. |
| `briefing` | phonemizer isn't loaded at boot. A PC call speaks through Kokoro in its own process. Two briefings in a row succeed with a broken feed among real ones. The server keeps answering with no fatal stop, and no configured secret appears in `server.log` or `crash.log`. |

A cut-off compressed response can't reach a briefing here, because `safeFetch` refuses local addresses. `npm test` reproduces it
deterministically with the real fetcher and phonemizer, in `tests/briefing-crash-policy.test.ts`, `tests/fetch-gzip-crash.test.ts`
and `tests/safe-fetch-body.test.ts`. The `briefing` check needs the public feeds (Google News) to be reachable.

## What it uses (test values only)

- **Supabase:** a local stack started with the Supabase CLI (pinned) in Docker, with every migration in `supabase/migrations`. It
  uses only the CLI's public local demo keys and one throwaway user, `orbit-test@example.test`, whose password is generated at setup.
- **Model:** `fake-claude.mjs` stands in for the Claude Code CLI (`ORBIT_CLAUDE_BIN`). There's no model, account or network. Markers
  in a task's request steer it (`[slow:N]`, `[fail]`, `[failonce:ID]`, `[propose:create_project]`).
- **Server:** a scratch data folder, the build in `.next-isolated`, port 3100. The server gets a clean environment with only these
  values, and every outbound integration (YouTube, ntfy, Voyage, mail, …) is unset.
- **Real keys:** setup refuses to run where a `.env` or `.env.local` exists, so no real key can be loaded next to the test values.

## Requirements

Linux, macOS or WSL (it kills its own server's process group). You also need Docker, Node ≥ 22.7, `npm ci` done in the checkout, and
Playwright's Chromium (`npx playwright install chromium` if `require("playwright")` can't launch one).

## Run

Use a separate checkout of the commit to test, never the live ORBIT folder:

```sh
git worktree add ../orbit-isolated <commit>      # or a fresh clone
cd ../orbit-isolated && npm ci
node scripts/isolated/setup.mjs                  # local Supabase + test user + build (a few minutes the first time)
node scripts/isolated/run-all.mjs                # all checks; or e.g. `run-all.mjs basic pair`
node scripts/isolated/cleanup.mjs                # stop the server, remove the stack, its data and the build
```

`ORBIT_ISO_DIR` moves the scratch folder (default `<tmp>/orbit-isolated`). After changing code, rerun `setup.mjs` to rebuild.
The supabase ports (54321/54322) must be free.

## Limits

These checks give evidence about orchestration and recovery, not about real Claude output, Windows file locking (simulated with an
unreadable path), or live integrations. Those need their own smoke checks after deployment.
