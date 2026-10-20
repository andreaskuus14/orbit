-- ORBIT BUSINESS planet: the owner's client pipeline for the Lead Follow-up Autopilot (src/lib/business-pure.ts).
-- One row per business he plans to contact; `draft` is the last outreach message CORE wrote (he sends it himself).

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default '' check (char_length(kind) <= 80),
  contact text not null default '' check (char_length(contact) <= 200),
  stage text not null default 'lead' check (stage in ('lead','contacted','replied','pilot','paying','lost')),
  fee numeric(10,2) not null default 0 check (fee >= 0 and fee <= 100000), -- € per month, counted only while paying
  notes text not null default '' check (char_length(notes) <= 2000),
  draft text not null default '' check (char_length(draft) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prospects_user_stage on public.prospects (user_id, stage, updated_at desc);

alter table public.prospects enable row level security;
create policy "own prospects" on public.prospects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
