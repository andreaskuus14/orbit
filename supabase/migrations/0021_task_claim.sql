-- Task claims: the worker (server process) that owns a running task. With started_at as the lease, a task runs only
-- after one atomic claim and a dead worker's task is reclaimable only after the lease (20 min) expires.
alter table public.tasks add column if not exists claimed_by text;
