-- ORBIT: CORE's learned playbook. Short "how the user likes things done" rules CORE updates between chats.
-- Fully visible and editable by the user (Profile panel); history keeps the last ~20 versions for revert.

create table public.core_playbook (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rules text[] not null default '{}',
  version int not null default 0,
  history jsonb not null default '[]',
  updated_at timestamptz default now()
);

alter table public.core_playbook enable row level security;
create policy "own playbook" on public.core_playbook for all using (user_id = auth.uid()) with check (user_id = auth.uid());
