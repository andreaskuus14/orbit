-- ORBIT Goals mode: a goal with a plan of agent steps that advances only on events (step finished, owner opens ORBIT, Continue).
-- The whole goal (plan, metric samples, timeline) lives in `doc` (shape: src/lib/goals-pure.ts Goal); `version` is a compare-and-swap
-- counter so two requests can never both apply a change (e.g. a double OK click). Step work runs as ordinary rows in public.tasks.

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft','approved','running','waiting','paused','blocked','done','stopped')),
  version integer not null default 0,
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and pg_column_size(doc) < 400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_status on public.goals (user_id, status, updated_at desc);

alter table public.goals enable row level security;
create policy "own goals" on public.goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
