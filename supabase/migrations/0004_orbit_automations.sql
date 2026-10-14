-- ORBIT Automation Studio: user-defined workflows (schedule or event triggered) that run as agent tasks.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  enabled boolean not null default true,
  trigger text not null check (trigger in ('schedule','event')),
  schedule jsonb,                       -- {every: hour|day|week, hour, minute, weekday}
  event text check (event in ('memory.created','briefing.ready')),
  kind_filter text,                     -- e.g. only memories of kind 'document'
  agent text not null default 'nova',
  prompt text not null check (char_length(prompt) between 5 and 4000),
  last_run_at timestamptz,
  run_count int not null default 0,
  created_at timestamptz not null default now(),
  check ((trigger = 'schedule' and schedule is not null) or (trigger = 'event' and event is not null))
);
create index automations_user on public.automations (user_id, enabled);

alter table public.tasks add column automation_id uuid references public.automations (id) on delete set null;
create index tasks_automation on public.tasks (automation_id, created_at desc);

alter table public.automations enable row level security;
create policy "own automations" on public.automations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
