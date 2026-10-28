# Releases and rollback

## What is running

Open DEV → Doctor. Two rows answer it:

- **Running version**: the commit stamped into the running build (`ORBIT_BUILD_COMMIT`, set by `next.config.ts` from `git rev-parse HEAD` at build time) and its build time; the commit checked out on disk (and whether it has uncommitted changes); `origin/main` as of the last `git fetch`; and any experimental settings that are set (`ORBIT_CORE_ENGINE`, `ORBIT_CORE_SESSION`, ...). It warns when the checkout differs from what is running, which means a rebuild or restart is pending.
- **Database migrations**: which files in `supabase/migrations` are confirmed applied, by read-only probes of a table or column each one adds. Migrations that only add policies, functions or constraints can't be probed without writing, so they are listed as unchecked.

"Merged" (origin/main), "built" (checkout) and "running" (stamp) are separate claims. Only the stamp says what is actually serving requests.

## Making a release

1. Merge the PR once CI is green on that exact commit. If CI never started (billing, runner outage), the run shows no logs. Run `npm run gate` locally on the same commit and note that in the PR.
2. On the PC: `git pull`, then `npm ci` (installs exactly what `package-lock.json` says), then `npm run app:rebuild`.
3. Tag what you deployed: `git tag release-YYYYMMDD-HHMM && git push origin --tags`.
4. Check Doctor: the running commit matches the tag and no migration is missing.

Dependencies change only through `package-lock.json`. Update it with `npm install <pkg>` and commit it with the code that needs it. CI uses `npm ci`, which fails if `package.json` and the lockfile disagree.

## Rolling back

Migrations only go forward. ORBIT has no down-migrations, and older code doesn't know about newer tables or columns.

1. Pick the last good tag: `git tag -l "release-*"`.
2. Compare migrations: `git diff --name-only <tag> HEAD -- supabase/migrations`.
   - **Nothing listed**: rolling back is safe.
   - **Only additive changes** (new tables, new nullable columns): older code usually ignores them. Rolling back is usually safe, but anything written into those tables or columns while the old code runs won't be kept up to date.
   - **Renames, drops, new NOT NULL columns or changed constraints**: don't roll back the code alone. Fix forward instead, or write a compatibility migration first.
3. Roll back: `git checkout <tag>`, `npm ci`, `npm run app:rebuild`. Don't reverse migrations by hand. Never drop a table that holds data.
4. In Doctor, the running commit should now equal the tag.
5. Go back to `main` with `git checkout main` once the fix is merged.

The launcher builds into `.next-build` and swaps that folder in only when the build succeeds, so a failed rebuild leaves the previous working build running.
