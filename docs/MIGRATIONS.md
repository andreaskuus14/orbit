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

## Optional: 0025

| File | Adds | Until it's applied |
|---|---|---|
| `0025_task_origin.sql` | `tasks.origin` | Scorecard replays are saved without an origin. "Continue my work" still hides them by matching their exact case, so nothing breaks. |

## How to apply

1. Open your project at supabase.com → **SQL Editor** → **New query**.
2. Paste the whole contents of `supabase/migrations/0021_task_claim.sql` and click **Run**.
3. Repeat for `0022_proposal_basis.sql` and then `0023_attempt_ids.sql`, oldest first.
4. Each file is idempotent (`if not exists`), so running one twice is harmless.

ORBIT checks again every 3 minutes. Queued tasks start and approvals go through without a restart. To confirm sooner, open Doctor.
