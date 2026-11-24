-- Durable queue for heavy GPU jobs (pictures, video, music, 3D, voice, upscale, Blender renders). Step 1 of the
-- "brain + muscle" plan (docs/gpu-queue.md): the ORBIT server enqueues, a worker (today: the laptop's own ORBIT server)
-- claims a job with a lease, runs it and writes the result. Only used when ORBIT_GPU_QUEUE=1; nothing reads it otherwise.
-- payload holds the tool input only (prompt, VAULT file names). Journal / LIFE text never goes in: gpu-queue-pure.ts
-- validatePayload refuses it before the insert, and the check below caps the size.
create table if not exists public.gpu_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('image', 'image_edit', 'video', 'music', '3d', 'voice', 'upscale', 'blender_render')),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 32768),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'running', 'done', 'failed', 'cancelled')),
  worker text,
  progress real not null default 0 check (progress >= 0 and progress <= 1),
  progress_text text,
  result jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),   -- retry backoff: not claimable before this
  lease_until timestamptz,                         -- a claimed/running job whose lease ran out is claimable again
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists gpu_jobs_claimable on public.gpu_jobs (run_after, created_at) where status in ('queued', 'claimed', 'running');
create index if not exists gpu_jobs_user_recent on public.gpu_jobs (user_id, created_at desc);

alter table public.gpu_jobs enable row level security;
drop policy if exists gpu_jobs_own on public.gpu_jobs;
create policy gpu_jobs_own on public.gpu_jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Claim the oldest runnable job of the given kinds with a lease, atomically (skip locked: two workers never get the same
-- job). A job whose worker stopped answering (lease ran out) is taken over; once it has used all its attempts it is failed
-- instead. Called with the service key by the worker; p_user limits it to one owner (null = any).
create or replace function public.claim_gpu_job(p_worker text, p_kinds text[], p_lease_seconds int, p_user uuid default null)
returns setof public.gpu_jobs
language plpgsql security invoker set search_path = public as $$
begin
  update public.gpu_jobs
     set status = 'failed', error = coalesce(error, 'The worker stopped answering too many times'), finished_at = now(), updated_at = now(), lease_until = null
   where status in ('claimed', 'running') and lease_until < now() and attempts >= max_attempts
     and (p_user is null or user_id = p_user);
  return query
  update public.gpu_jobs j
     set status = 'claimed', worker = p_worker, attempts = j.attempts + 1, claimed_at = now(), updated_at = now(),
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600)))
   where j.id = (
     select c.id from public.gpu_jobs c
      where c.kind = any(p_kinds) and (p_user is null or c.user_id = p_user)
        and ((c.status = 'queued' and c.run_after <= now())
          or (c.status in ('claimed', 'running') and c.lease_until < now() and c.attempts < c.max_attempts))
      order by c.run_after, c.created_at
      limit 1
      for update skip locked)
  returning j.*;
end;
$$;
