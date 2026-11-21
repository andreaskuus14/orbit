# Journal encryption and encrypted backups

One-time setup, from the ORBIT folder:

```
powershell -ExecutionPolicy Bypass -File tools\backup\setup.ps1
```

(options: `-Repo D:\orbit-restic`, `-Keep 14`, `-Cloud "myremote:orbit"`, `-At 03:20`, `-SkipJournal`)

## The journal key: read this

- Journal / LIFE text (LIFE → Journal days, evening "Today in a minute" notes, voice-memo journal notes; titles too) is stored
  encrypted with AES-256-GCM. The key is one file on this PC: `%LOCALAPPDATA%\orbit\keys\journal.key` (or `ORBIT_JOURNAL_KEY_FILE`).
  It is never in Supabase, never in git, and never in the backups.
- Setup shows a **recovery key** (17 groups of 4 characters) and won't continue until you type its last group.
  **If you lose the key file AND the recovery key, the journal is gone for good.** Nobody can open it: not ORBIT, not Claude, not Supabase.
- New PC / reinstall: `node --experimental-strip-types scripts/journal-key.ts recover` and type the recovery key.
- `node --experimental-strip-types scripts/journal-key.ts status` shows where the key is and its id (never the key).
- Journal entries have no embeddings and no full-text match (embedding = showing text to a model). LIFE → Journal opens them;
  everywhere else (MEMORY list, map, search results, Chronicle) they show as "Journal entry · <day>".

## Encrypting existing entries (one time)

```
npm run app:stop
npm run journal:encrypt        # encrypted backup first, then encrypt + verify every entry, then the "plain text left?" check
npm run journal:check          # exit 0 = no plain-text journal left in life.json or Supabase
```

Running it again does nothing (already-encrypted values are skipped). The backup is
`%LOCALAPPDATA%\orbit\journal-backups\journal-before-encrypt-<time>.ojb` (encrypted with the journal key).

Rollback (needs the key):

```
node --experimental-strip-types scripts/journal-encrypt.ts --rollback                      # decrypt everything in place
node --experimental-strip-types scripts/journal-encrypt.ts --restore-backup <file.ojb>     # write a backup's text back
```

After a rollback, new entries are still encrypted while the key file exists; move the key file away to stop that.
`--check` also lists older plain JSON exports in `..\orbit-backups` (the weekly export from before this change). ORBIT never
deletes them; delete them yourself once the restic backups work.

## Nightly backups (restic)

- What: the ORBIT data folder (`%LOCALAPPDATA%\orbit`: life.json, VAULT, CRM, settings…), the STUDIO folder's state files
  (`..\orbit-studio`, without renders, downloads, models and audio) and an export of every ORBIT Supabase table.
  Never: `.env.local` / `.env*`, the `keys` folder.
- Where: the local restic repo (default `%USERPROFILE%\orbit-restic`), encrypted with the password in
  `%LOCALAPPDATA%\orbit\keys\restic.pass` (shown once at setup: save it in your password manager).
- When: Task Scheduler "ORBIT nightly backup" at 03:20 (later if the PC was off). Keeps 14 daily, 8 weekly, 12 monthly.
- Cloud: only if you pass `-Cloud remote:path` (a remote you made with `rclone config`) or put `"cloud": "remote:path"` in
  `%LOCALAPPDATA%\orbit\backup.json`. Otherwise nothing is uploaded.
- Status: the doctor's "Encrypted backups (restic)" line shows the last good backup's age. Log: `%LOCALAPPDATA%\orbit\backup.log`.

```
npm run backup:run                                   # back up now
npm run backup:snapshots                             # list snapshots
npm run backup:restore -- --target C:\orbit-restore  # latest snapshot into an EMPTY folder (add --snapshot <id> for another)
```

Restores never write over the live folders. Look at the restored files, stop ORBIT, copy back what you need. The Supabase
export is `supabase-<user id>.json` inside the restored temp folder path; there is no automatic importer (use the Supabase
SQL editor / Table editor to put rows back). Journal rows in it are still encrypted: restore the journal key to read them.
