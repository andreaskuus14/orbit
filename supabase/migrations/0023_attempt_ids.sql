-- Approved-action idempotency: the stable attempt id (taskId:index) of the approved action that created the row. A rerun of the
-- same attempt (after a crash before its receipt, then the owner's retry) finds this row instead of creating a second one.
-- Memories use a tag (attempt:<id>) in their existing tags column instead.
alter table public.projects add column if not exists attempt_id text;
alter table public.tasks add column if not exists attempt_id text;
alter table public.automations add column if not exists attempt_id text;
create unique index if not exists projects_attempt on public.projects (user_id, attempt_id) where attempt_id is not null;
create unique index if not exists tasks_attempt on public.tasks (user_id, attempt_id) where attempt_id is not null;
create unique index if not exists automations_attempt on public.automations (user_id, attempt_id) where attempt_id is not null;
