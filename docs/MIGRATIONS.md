# Database migrations

ORBIT's schema lives in `supabase/migrations`. Apply new files yourself in the Supabase SQL editor. Doctor → **Database migrations** lists any file that is still missing, by its full path.

## Required: 0021–0023

ORBIT refuses some work until these three are applied. It doesn't fall back to a weaker version. Nothing is lost while it waits:

| File | Adds | Until it's applied |
|---|---|---|
| `0021_task_claim.sql` | `tasks.claimed_by` | Agent tasks don't start. They stay **queued**, not failed. |
| `0022_proposal_basis.sql` | `proposals.basis` | Approving a suggestion is refused. The suggestion stays **pending**. |
| `0023_attempt_ids.sql` | `attempt_id` on projects, tasks and automations | Approvals that create a project, task or automation are refused. The approval stays **pending**. |

Needs you shows one **Unblock** item with the exact file name until they are applied.

## Optional: 0025-0028

| File | Adds | Until it's applied |
|---|---|---|
| `0025_task_origin.sql` | `tasks.origin` | Scorecard replays are saved without an origin. "Continue my work" still hides them by matching their exact case, so nothing breaks. |
| `0026_prospect_drafted_at.sql` | `prospects.drafted_at` | Drafts are saved without the stamp, so Auto (business-send) sends none of them. Nothing else changes. |
| `0028_agent_task_counts.sql` | `agent_task_counts()` | OPERATIONS → Agents reads every task row for its counts (the old, slower way). Same numbers. |

## How to apply

1. Open your project at supabase.com → **SQL Editor** → **New query**.
2. Paste the whole contents of `supabase/migrations/0021_task_claim.sql` and click **Run**.
3. Repeat for `0022_proposal_basis.sql` and then `0023_attempt_ids.sql`, oldest first.
4. Running a file twice never deletes or changes data. Most files just run again. Some older ones (see below) stop with an "already exists" error. That is fine: nothing was changed.

ORBIT checks again every 3 minutes. Queued tasks start and approvals go through without a restart. To confirm sooner, open Doctor.

## Running a file twice

Checked by `scripts/migrations-dryrun.sh` on a test database. When pasted whole into the SQL editor, every file either runs again with no change, or stops with an error and changes nothing.

- These stop with "already exists" if run again: 0001–0008, 0010, 0011, 0013. They are already applied, so skip them.
- **Don't re-run 0017 on its own.** After 0018, re-running 0017 fails because episode memories exist. If it runs line by line instead of as one paste, it removes the check on memory kinds and doesn't add it back. To fix that, run 0018 again.
- Re-running 0009 sets the vault file limit back to 50 MB.
- 0012 and 0014–0029 run again with no change.

## Dry run (for developers)

`scripts/migrations-dryrun.sh` starts a temporary local Postgres, adds stand-ins for Supabase's parts (auth, `auth.uid()`, storage, the anon/authenticated/service_role roles, realtime), applies every file in order, adds some sample rows, then runs every file again and checks that no data changed. No network, and it never touches the real database.

- Needs Postgres 15+ and pgvector (Ubuntu: `apt install postgresql-16 postgresql-16-pgvector`).
- `--strict-rerun-from 0018` also fails if a newer file can't run twice. CI (`.github/workflows/migrations.yml`) and `tests/migrations-dryrun.test.ts` use this. The test is skipped when Postgres isn't installed.
- `--autocommit` runs the second pass line by line, to show what a half-applied file leaves behind.
- New files must be safe to run twice: use `if not exists`, `create or replace`, and `drop … if exists` before `create policy`, `create trigger` and `add constraint`.
