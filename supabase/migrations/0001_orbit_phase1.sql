-- ORBIT Phase 1 schema: profiles, memories (pgvector + full-text), links,
-- CORE conversations, universe events (realtime), usage/cost tracking, file vault.
-- Every table is row-level secured to its owner.

create extension if not exists vector with schema extensions;

set search_path = public, extensions;

-- ---------- helpers ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  interests text[] not null default '{}',
  projects text[] not null default '{}',
  goals text[] not null default '{}',
  news_topics text[] not null default '{}',
  research_priorities text[] not null default '{}',
  communication text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- memories ----------
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'note' check (kind in
    ('note','idea','link','document','image','research','conversation','project','preference','decision','goal')),
  title text not null check (char_length(title) between 1 and 300),
  content text not null default '' check (char_length(content) <= 200000),
  source text not null default 'capture',          -- where it came from: capture, core, upload, url
  url text,
  storage_path text,                               -- object in the private 'vault' bucket
  tags text[] not null default '{}',
  folder text,
  visibility text not null default 'private' check (visibility in ('private','agents')),
  embedding extensions.vector(1024),
  fts tsvector generated always as
    (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_user_created on public.memories (user_id, created_at desc);
create index memories_fts on public.memories using gin (fts);
create index memories_tags on public.memories using gin (tags);
create index memories_embedding on public.memories using hnsw (embedding extensions.vector_cosine_ops);
create trigger memories_touch before update on public.memories
  for each row execute function public.touch_updated_at();

-- Semantic search, scoped to the caller by RLS + explicit filter.
create or replace function public.match_memories(
  query_embedding extensions.vector(1024),
  match_count int default 10,
  exclude_id uuid default null
)
returns table (id uuid, title text, kind text, similarity float)
language sql stable security invoker
set search_path = public, extensions as $$
  select m.id, m.title, m.kind, 1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.user_id = auth.uid()
    and m.embedding is not null
    and (exclude_id is null or m.id <> exclude_id)
  order by m.embedding <=> query_embedding
  limit least(match_count, 50);
$$;

-- ---------- memory links (backlinks / suggested relationships) ----------
create table public.memory_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_id uuid not null references public.memories (id) on delete cascade,
  to_id uuid not null references public.memories (id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested','confirmed','rejected')),
  score real,
  reason text,
  created_at timestamptz not null default now(),
  unique (from_id, to_id),
  check (from_id <> to_id)
);
create index memory_links_user on public.memory_links (user_id, status);

-- ---------- CORE conversations ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations jsonb not null default '[]',
  trace jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index messages_conv on public.messages (conversation_id, created_at);

-- ---------- universe events (drives the living galaxy + audit trail) ----------
create table public.events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null,              -- e.g. memory.created, core.started, core.completed, core.failed
  planet text not null,            -- core, memory, intelligence, ...
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_user_created on public.events (user_id, created_at desc);

-- ---------- usage / cost tracking ----------
create table public.usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model text not null,
  purpose text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index usage_user_created on public.usage (user_id, created_at desc);

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.memories enable row level security;
alter table public.memory_links enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;
alter table public.usage enable row level security;

create policy "own profile" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy "own memories" on public.memories for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own links" on public.memory_links for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.memories m where m.id = from_id and m.user_id = auth.uid())
    and exists (select 1 from public.memories m where m.id = to_id and m.user_id = auth.uid())
  );

create policy "own conversations" on public.conversations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own messages" on public.messages for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

-- Events and usage are append-only from the app: insert + read, no update/delete.
create policy "read own events" on public.events for select using (user_id = auth.uid());
create policy "insert own events" on public.events for insert with check (user_id = auth.uid());
create policy "read own usage" on public.usage for select using (user_id = auth.uid());
create policy "insert own usage" on public.usage for insert with check (user_id = auth.uid());

-- ---------- realtime ----------
alter publication supabase_realtime add table public.events;

-- ---------- private file vault ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault', 'vault', false, 4194304)
on conflict (id) do nothing;

create policy "vault read own" on storage.objects for select
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault write own" on storage.objects for insert
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault delete own" on storage.objects for delete
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
