# Idea Radar public transcript input

Branch: `codex/idea-radar-transcripts`.

Latest work and validation superseding the historical blocker below: see [upgrade progress](UPGRADE-PROGRESS-2026-11-01.md).

## Delivered

AGENTS → Ideas → **Have a public transcript?** accepts a source title and 200–60,000 characters after explicit confirmation that the material is public, not LIFE/journal text. It uses the existing model prompt and ideas store without downloading media. Transcript-derived ideas are labeled as undated research and shown even with Hide stale enabled. Their source dates remain unknown; they are excluded from automatic Shorts candidate selection. Reanalyzing identical trimmed text replaces that transcript's previous ideas while preserving other records. Stop-all, usage holds and cancellation refuse the operation. Activity logs record only the count and fixed source-status label, not pasted content.

English and Estonian input/help/status text is included. No dependencies or migrations. No REA edits, deployment or live data changes.

## Follow-up: all-category ideas

Idea Radar now classifies new public-source ideas across 27 ORBIT areas plus Other. The category descriptions used in the extraction prompt and the labels/options shown on the board come from one catalog in `ideas-pure.ts`. Categories include ARCH, MEMORY, INTELLIGENCE, LIFE, School, People, VAULT, Workspaces, Money, Voice, Phone, System, and daily/weekly reviews alongside the original areas.

The Category selector filters existing board records without rewriting them or invoking the model. It preserves score thresholds, dismissed records, stale-video visibility and the explicit undated-research exception. Existing saved category IDs remain valid; old Other records are not silently reclassified. Classification does not add model tools or permission to access LIFE/journal data.

Follow-up focused verification: all 36 checks passed across pure classification/view logic, transcript API/I/O, rendered UI, automatic Shorts exclusion, translations, accessibility and route guards. The follow-up gate passed type checking; its suite finished with 3,029 tests: 3,024 passed, 1 failed, 4 skipped. The remaining failure is the same Windows ws-server EPERM cleanup blocker described below. The separate synthetic AI evaluation and isolated production build passed. Build-generated tsconfig changes were discarded; the live build was not replaced.

## Validation

- All 33 focused pure, API, I/O, rendered UI, Shorts-selection, translation, accessibility and route-safety checks passed.
- Type checking passed in the isolated full gate.
- First isolated full suite: 3,026 tests; 3,019 passed, 3 failed, 4 skipped.
- Two failures were existing CRLF assumptions in source-inspection tests (`core-operator.test.ts`, `core-sdk.test.ts`). Their assertions now normalize/accept Windows newlines; the same selected assertions pass.
- Remaining blocker: `tests/ws-server.test.ts`, test **real server: start, smoke check, sandbox, stop, Stop-all**. This Windows host exposes additional environment variables in the spawned Node process; the test expects a shorter allowlist. A rerun with cleanup retries exposed the underlying environment assertion (the first run's cleanup also encountered EPERM). The cleanup change was discarded, and the environment/security assertion has not been relaxed. Reported variables included HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH, SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE and WINDIR. File access and child-spawn protections still returned ERR_ACCESS_DENIED in that run.
- A separate Windows portability fix uses fileURLToPath in the translation-coverage test; its existing URL.pathname conversion produced C:\\C:\\... on Windows.
- AI synthetic evaluation passed separately. The isolated production build passed, including type validation and page generation, into `.next-idea-radar-check`. The live build was not replaced. Build-generated tsconfig edits were discarded.

The required full gate is **not green** while the workspace-server environment test fails. No pull request should be opened or deployment performed until the complete gate passes. Claude remains reviewer/merger/deployer. Logs are local, untracked `idea-radar-gate.log`, `windows-checks.log`, `idea-radar-eval.log`, and `idea-radar-build.log` in the isolated worktree.

## Isolation

Changes were moved to `C:\Users\andre\.codex\worktrees\idea-radar-transcripts\orbit`. The owner's running checkout at `C:\Users\andre\Documents\orbit` was returned to `main`; pre-existing icon/assets and unrelated untracked files were preserved. The worktree reuses the installed node_modules through a junction and does not copy .env.local.
