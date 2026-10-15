-- ORBIT Phase 2c: proactive proposals. Agents suggest work; nothing runs until the user approves (then it becomes a task).

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  why text not null default '' check (char_length(why) <= 1000),
  agent text not null,
  prompt text not null check (char_length(prompt) between 1 and 8000),
  kind text not null default 'followup' check (char_length(kind) <= 40),
  status text not null default 'pending' check (status in ('pending','approved','dismissed')),
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index proposals_user_status on public.proposals (user_id, status, created_at desc);

alter table public.proposals enable row level security;
create policy "own proposals" on public.proposals for all using (user_id = auth.uid()) with check (user_id = auth.uid());
