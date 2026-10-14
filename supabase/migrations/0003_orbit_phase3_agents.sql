-- ORBIT Phase 3: custom agents, projects, and persistent agent tasks (with traces and approvals). Owner-only RLS.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(name) between 1 and 60),
  role text not null default '',
  instructions text not null default '' check (char_length(instructions) <= 8000),
  tools text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  status text not null default 'active' check (status in ('active','paused','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  agent text not null,
  title text not null check (char_length(title) between 1 and 200),
  request text not null check (char_length(request) <= 8000),
  status text not null default 'queued'
    check (status in ('queued','running','awaiting_approval','done','failed','cancelled')),
  result text,
  error text,
  trace jsonb not null default '[]',
  pending jsonb not null default '[]',   -- actions waiting for the user's approval
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index tasks_user_created on public.tasks (user_id, created_at desc);
create index tasks_user_status on public.tasks (user_id, status);
create index tasks_parent on public.tasks (parent_id);

alter table public.agents enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;

create policy "own agents" on public.agents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own projects" on public.projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- A policy on tasks can't query tasks (infinite recursion), so the parent check goes through a definer function.
create or replace function public.owns_task(tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tasks where id = tid and user_id = auth.uid());
$$;

create policy "own tasks" on public.tasks for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (parent_id is null or public.owns_task(parent_id))
    and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid()))
  );
