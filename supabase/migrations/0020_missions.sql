-- ORBIT Missions (src/lib/missions-pure.ts): one authoritative record per multi-step request. The record (objective, constraints,
-- receipts, decisions, blockers, retries, log) lives in `doc`; the steps run as an agent-team chain in public.tasks (chain_id).
-- `version` is a compare-and-swap counter so two requests can never both apply a change. Idempotent.

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chain_id uuid references public.tasks (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','running','waiting-input','waiting-approval','paused','failed','completed','cancelled')),
  version integer not null default 0,
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists missions_user_status on public.missions (user_id, status, created_at desc);

alter table public.missions enable row level security;
drop policy if exists "own missions" on public.missions;
create policy "own missions" on public.missions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
