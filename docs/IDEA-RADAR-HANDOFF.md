# Idea Radar public transcript input

Branch: `codex/idea-radar-transcripts`.

## Delivered

AGENTS → Ideas → **Have a public transcript?** accepts a source title and 200–60,000 characters after explicit confirmation that the material is public, not LIFE/journal text. It uses the existing model prompt and ideas store without downloading media. Transcript-derived ideas are labeled as undated research and shown even with Hide stale enabled. Their source dates remain unknown; they are excluded from automatic Shorts candidate selection. Reanalyzing identical trimmed text replaces that transcript's previous ideas while preserving other records. Stop-all, usage holds and cancellation refuse the operation. Activity logs record only the count and fixed source-status label, not pasted content.

English and Estonian input/help/status text is included. No dependencies or migrations. No REA edits, deployment or live data changes.

## Validation

- Focused pure, API, I/O, rendered UI, Shorts-selection and translation coverage checks passed.
- Type checking passed in the isolated full gate.
- First isolated full suite: 3,026 tests; 3,019 passed, 3 failed, 4 skipped.
- Two failures were existing CRLF assumptions in source-inspection tests (`core-operator.test.ts`, `core-sdk.test.ts`). Their assertions now normalize/accept Windows newlines; the same selected assertions pass.
- Remaining blocker: `tests/ws-server.test.ts`, test **real server: start, smoke check, sandbox, stop, Stop-all**. This Windows host exposes additional environment variables in the spawned Node process; the test expects a shorter allowlist. A rerun with cleanup retries exposed the underlying environment assertion (the first run's cleanup also encountered EPERM). The cleanup change was discarded, and the environment/security assertion has not been relaxed. Reported variables included HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE and WINDIR. File access and child-spawn protections still returned ERR_ACCESS_DENIED in that run.
- A separate Windows portability fix uses fileURLToPath in the translation-coverage test; its existing URL.pathname conversion produced C:\\C:\\... on Windows.
- AI synthetic evaluation passed separately. Production build is run separately into `.next-idea-radar-check`; consult the final handoff message for its outcome.

The required full gate is **not green** while the workspace-server environment test fails. No pull request should be opened or deployment performed until the complete gate passes. Claude remains reviewer/merger/deployer. Logs are local, untracked `idea-radar-gate.log`, `windows-checks.log`, `idea-radar-eval.log`, and `idea-radar-build.log` in the isolated worktree.

## Isolation

Changes were moved to `C:\Users\andre\.codex\worktrees\idea-radar-transcripts\orbit`. The owner's running checkout at `C:\Users\andre\Documents\orbit` was returned to `main`; pre-existing icon/assets and unrelated untracked files were preserved. The worktree reuses the installed node_modules through a junction and does not copy .env.local.
