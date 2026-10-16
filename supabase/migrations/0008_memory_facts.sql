-- ORBIT: CORE's beliefs about the user. Small "subject → statement" facts taken from the user's own words.
-- A newer statement on the same subject supersedes the old one (kept, linked via supersedes); Forget = retracted.
-- Shown and editable in MEMORY → "What ORBIT believes". The app works without this table (falls back silently).

create table public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 80),
  statement text not null check (char_length(statement) between 1 and 400),
  status text not null default 'current' check (status in ('current','superseded','retracted')),
  source text not null default 'user_said' check (source in ('user_said','inferred','document')),
  source_ref uuid,                                  -- chat message id or memory id
  confidence real not null default 0.7 check (confidence between 0 and 1),
  supersedes uuid references public.memory_facts (id) on delete set null,
  superseded_by uuid,                               -- the fact that replaced this one (set before that row exists, so no FK)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memory_facts_user_status on public.memory_facts (user_id, status);
create index memory_facts_user_subject on public.memory_facts (user_id, subject);
-- One current belief per subject: concurrent writers can't both win.
create unique index memory_facts_one_current on public.memory_facts (user_id, subject) where status = 'current';
create trigger memory_facts_touch before update on public.memory_facts
  for each row execute function public.touch_updated_at();

alter function public.touch_updated_at() set search_path = public;

alter table public.memory_facts enable row level security;
create policy "own facts" on public.memory_facts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
