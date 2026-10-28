# Recovery

What to do when something breaks, matching the installed app. Drills are scripted in `tests/drill.test.ts` (run with `npm test`).

## What is backed up

| Data | Where | How |
|---|---|---|
| Local stores (`*.json`, `*.jsonl`, vault index) in ORBIT's data folder (`ORBIT_DATA_DIR`, else `%LOCALAPPDATA%\orbit`) | Folder you picked in Profile → Time capsule | Nightly encrypted `.orbitcap` file (14 nightly + 8 weekly kept) |
| Supabase tables + uploaded vault files | `ORBIT_BACKUP_DIR` (default `..\orbit-backups`) | Weekly plain JSON export |

`time-capsule.json` (folder, limit, verifier) is never in a backup. Each backup carries its own wrapped key, so it opens on a new PC with the file and the passphrase.

## Prove the backup works (restore drill)

Profile → Time capsule → enter the passphrase → **Run restore drill** (optionally pick a backup; default is the newest).
ORBIT opens the backup, restores it into a temporary folder, reads every file back, checks it is byte-identical and parses, compares the
count with the backup's header, then deletes the temporary folder. Your data folder is not touched. The result shows in **Doctor → Last recovery drill**
(warns if never run or older than 35 days, fails if the last drill failed). Run one after setting up and about once a month.

## Restore for real

1. Profile → Time capsule → pick a backup → passphrase → **Preview changes** (what would be created/overwritten; files only on disk now are kept).
2. **Restore**. ORBIT first writes a `pre-restore` safety backup of how things are now, then writes each file atomically.
3. Restart ORBIT (`npm run app:stop`, then the desktop shortcut) so every part reloads the data.
To undo, restore the `pre-restore` backup the same way.

## Restart during work

Every store is written as `file.tmp` then renamed, so a crash or restart leaves the last good version plus at most a stray `.tmp`, which
backups and restores ignore. Backups and restores run one at a time; if ORBIT restarts mid-restore, run the restore again: it converges to the same result.
An accepted day plan that was not finished is carried into the next day's plan explicitly ("Carried from an earlier day").

## Invalid passphrase, damaged file, invalid session

- Wrong passphrase → "Wrong passphrase"; nothing is written.
- Changed or truncated backup → "Backup file is damaged"; try an older one.
- `time-capsule.json` damaged → "set the time capsule up again". Old backups still open with the passphrase they were made with.
- Expired or foreign sign-in → the API answers 401/403 (`ORBIT_ALLOWED_EMAILS` limits who gets in); sign in again.

## Lost passphrase

The backups cannot be opened. Set the time capsule up again with a new passphrase; new backups use it.
